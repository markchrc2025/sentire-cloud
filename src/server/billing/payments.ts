import { and, eq, sql } from "drizzle-orm";
import { db, type DBorTx } from "../db/client";
import { billingStatements, checkoutSessions, creditNotes, organizations, payments, paywallEvents, sellerProfiles, webhookEvents, withholdings } from "../db/schema";
import { inOrg, type OrgContext } from "../db/dal";
import { requireRole } from "../account/orgs";
import { env } from "@/lib/env";
import { percent } from "@/lib/money";
import { manilaDate } from "@/lib/time";
import { log } from "@/lib/log";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { sendMail } from "../mail/send";
import { billingMails } from "./mails";
import { provider } from "./providers";
import { BillingError, balance } from "./statements";
import { activatedQueue, onStatementPaid } from "./subscriptions";
import { billingHooks } from "./hooks";

export const ATCS: Record<string, { label: string; basisPoints: number }> = {
  WC160: { label: "WC160: 2% services by corporations (income payments by top withholding agents)", basisPoints: 200 },
  WI160: { label: "WI160: 2% services by individuals (top withholding agents)", basisPoints: 200 },
  WC158: { label: "WC158: 1% goods by corporations (top withholding agents)", basisPoints: 100 },
};

export function quarterOf(date: string) {
  return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

async function afterCommit() {
  const items = activatedQueue.splice(0);
  for (const [org, sub] of items) for (const h of billingHooks.onActivated) await h(org, sub).catch((e) => log.error({ err: e }, "activation hook failed"));
}

/**
 * Apply money to a statement (append-only payment, optional withholding). Idempotent by key (NFR-08).
 * When the statement is settled it becomes Paid and the subscription moves on.
 */
export async function recordPayment(
  input: {
    statementId: string;
    amountCentavos: number;
    method: "CARD" | "GCASH" | "MAYA" | "BANK_TRANSFER" | "CASH" | "CREDIT" | "TEST";
    provider?: string | null;
    providerRef?: string | null;
    idempotencyKey: string;
    reference?: string | null;
    recordedBy?: string | null;
    withholding?: { atc: string; basisPoints: number; amountCentavos: number } | null;
  },
  tx?: DBorTx,
) {
  const run = async (t: DBorTx) => {
    const [dup] = await t.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey));
    if (dup) return { payment: dup, duplicate: true };
    const [st] = await t.select().from(billingStatements).where(eq(billingStatements.id, input.statementId)).for("update");
    if (!st) throw new BillingError("Statement not found.");
    if (st.status === "VOID") throw new BillingError("This statement was voided.");
    const today = manilaDate();
    const [p] = await t
      .insert(payments)
      .values({
        organizationId: st.organizationId,
        statementId: st.id,
        method: input.method,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        amountCentavos: input.amountCentavos,
        idempotencyKey: input.idempotencyKey,
        reference: input.reference ?? null,
        recordedBy: input.recordedBy ?? null,
        paidAt: new Date(),
      })
      .returning();
    const withheld = input.withholding?.amountCentavos ?? 0;
    if (input.withholding && withheld > 0) {
      await t.insert(withholdings).values({ organizationId: st.organizationId, statementId: st.id, paymentId: p!.id, atc: input.withholding.atc, rateBasisPoints: input.withholding.basisPoints, amountCentavos: withheld, quarter: quarterOf(today) });
    }
    const paid = st.paidCentavos + input.amountCentavos;
    const wh = st.withheldCentavos + withheld;
    const settled = paid + wh + st.creditedCentavos >= st.totalCentavos;
    await t
      .update(billingStatements)
      .set({ paidCentavos: paid, withheldCentavos: wh, status: settled ? "PAID" : "PARTIALLY_PAID", paidAt: settled ? new Date() : null })
      .where(eq(billingStatements.id, st.id));
    await audit({ organizationId: st.organizationId, actorId: input.recordedBy ?? null, actorKind: input.recordedBy ? "staff" : "system", action: "payment.recorded", entity: "payment", entityId: p!.id, after: { statement: st.number, amount: input.amountCentavos, withheld, method: input.method } }, t);
    const [org] = await t.select().from(organizations).where(eq(organizations.id, st.organizationId));
    await sendMail({ to: org!.billingEmail, ...billingMails.receipt(st, input.amountCentavos + withheld, org!) });
    if (settled && st.status !== "PAID") {
      await onStatementPaid(st.id, t);
      await publishPaid(st.id, t);
    }
    return { payment: p!, duplicate: false };
  };
  const r = tx ? await run(tx) : await db().transaction(run);
  if (!tx) await afterCommit();
  return r;
}

/** billing.statement.paid carries what Sentire's own Ledger needs to issue the BIR invoice (CR-01). */
async function publishPaid(statementId: string, tx: DBorTx) {
  const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, statementId));
  const lines = await tx.execute(sql`select kind, description, quantity, unit_centavos, amount_centavos from statement_lines where statement_id = ${statementId} order by created_at`);
  await publish("billing.statement.paid", st!.organizationId, { statementId, number: st!.number, total: st!.totalCentavos, withheld: st!.withheldCentavos, buyer: st!.buyerSnapshot, seller: st!.sellerSnapshot, lines: Array.from(lines), paidAt: new Date().toISOString() }, tx);
}

/** UC-04 step 5: hosted checkout for the balance, optionally net of withholding (FR-19). */
export async function startCheckout(ctx: OrgContext, statementId: string, opts: { atc?: string | null; returnUrl?: string | null; paywallFeature?: string | null } = {}) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  const [st] = await db().select().from(billingStatements).where(inOrg(ctx, billingStatements.organizationId, eq(billingStatements.id, statementId)));
  if (!st || !["OPEN", "PARTIALLY_PAID"].includes(st.status)) throw new BillingError("This statement has nothing to pay.");
  const [org] = await db().select().from(organizations).where(eq(organizations.id, st.organizationId));
  const due = balance(st);
  const atc = opts.atc ? ATCS[opts.atc] : null;
  if (opts.atc && !atc) throw new BillingError("Unknown ATC.");
  if (atc && st.paidCentavos > 0) throw new BillingError("Withholding can be entered only on the first payment of a statement.");
  const withheld = atc ? percent(st.totalCentavos - st.taxCentavos, atc.basisPoints) : 0;
  const amount = due - withheld;
  const p = provider();
  const [cs] = await db()
    .insert(checkoutSessions)
    .values({ organizationId: st.organizationId, statementId: st.id, provider: p.name, amountCentavos: amount, returnUrl: opts.returnUrl ?? null, withholdingAtc: opts.atc ?? null, withholdingBasisPoints: atc?.basisPoints ?? null, withholdingCentavos: withheld || null, paywallFeature: opts.paywallFeature ?? null, createdBy: ctx.actorId })
    .returning();
  const base = env().APP_URL.replace(/\/$/, "");
  const created = await p.createCheckout({
    sessionId: cs!.id,
    statementNumber: st.number,
    description: `Sentire billing statement ${st.number}`,
    amountCentavos: amount,
    customerEmail: org!.billingEmail,
    customerName: org!.tradeName ?? org!.registeredName,
    successUrl: `${base}/org/billing/return?session=${cs!.id}`,
    cancelUrl: `${base}/org/billing/statements/${st.id}?error=Payment+was+not+completed.`,
  });
  await db().update(checkoutSessions).set({ providerRef: created.providerRef, url: created.url }).where(eq(checkoutSessions.id, cs!.id));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "checkout.started", entity: "checkout_session", entityId: cs!.id, after: { statement: st.number, amount, withheld, provider: p.name }, ip: ctx.ip });
  return { url: created.url, sessionId: cs!.id };
}

/** Provider webhook: verify, store once, apply once (UC-04 steps 5 to 6; 5b duplicates). */
export async function handleWebhook(providerName: string, headers: Headers, rawBody: string) {
  const p = provider(providerName);
  const evt = await p.parseWebhook(headers, rawBody);
  const inserted = await db().insert(webhookEvents).values({ provider: p.name, eventId: evt.eventId, type: evt.type, payload: evt.raw as never }).onConflictDoNothing().returning();
  if (!inserted.length) return { duplicate: true };
  try {
    if (evt.type === "payment.paid") {
      const [cs] = await db().select().from(checkoutSessions).where(and(eq(checkoutSessions.provider, p.name), eq(checkoutSessions.providerRef, evt.providerRef)));
      if (!cs) throw new Error(`unknown checkout ${evt.providerRef}`);
      if (evt.amountCentavos !== cs.amountCentavos) log.warn({ expected: cs.amountCentavos, got: evt.amountCentavos }, "payment amount differs from checkout");
      await db().transaction(async (tx) => {
        await tx.update(checkoutSessions).set({ status: "PAID" }).where(eq(checkoutSessions.id, cs.id));
        await recordPayment(
          {
            statementId: cs.statementId,
            amountCentavos: evt.amountCentavos,
            method: evt.method,
            provider: p.name,
            providerRef: evt.paymentRef,
            idempotencyKey: `${p.name}:${evt.paymentRef}`,
            withholding: cs.withholdingAtc && cs.withholdingCentavos ? { atc: cs.withholdingAtc, basisPoints: cs.withholdingBasisPoints!, amountCentavos: cs.withholdingCentavos } : null,
          },
          tx,
        );
      });
      await afterCommit();
      if (cs.paywallFeature) await db().insert(paywallEvents).values({ organizationId: cs.organizationId, featureKey: cs.paywallFeature, userId: cs.createdBy, action: "PURCHASED" });
    } else if (evt.type === "payment.failed") {
      await db().update(checkoutSessions).set({ status: "FAILED" }).where(and(eq(checkoutSessions.provider, p.name), eq(checkoutSessions.providerRef, evt.providerRef)));
    }
    await db().update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, inserted[0]!.id));
  } catch (e) {
    await db().update(webhookEvents).set({ error: (e as Error).message }).where(eq(webhookEvents.id, inserted[0]!.id));
    throw e;
  }
  return { duplicate: false };
}

/** FR-20: staff record a bank transfer (or cash) against a statement. */
export async function recordBankTransfer(staffId: string, input: { statementId: string; amountCentavos: number; reference: string; atc?: string | null }) {
  const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, input.statementId));
  if (!st) throw new BillingError("Statement not found.");
  const atc = input.atc ? ATCS[input.atc] : null;
  const withheld = atc ? percent(st.totalCentavos - st.taxCentavos, atc.basisPoints) : 0;
  return recordPayment({
    statementId: st.id,
    amountCentavos: input.amountCentavos,
    method: "BANK_TRANSFER",
    reference: input.reference,
    idempotencyKey: `bank:${st.id}:${input.reference}`,
    recordedBy: staffId,
    withholding: atc && st.paidCentavos === 0 ? { atc: input.atc!, basisPoints: atc.basisPoints, amountCentavos: withheld } : null,
  });
}

/** FR-20: credit note (reduces what is owed); refunds are recorded as negative payments. */
export async function issueCreditNote(staffId: string, input: { statementId: string; amountCentavos: number; reason: string }) {
  if (!input.reason.trim()) throw new BillingError("A reason is required.");
  if (input.amountCentavos <= 0) throw new BillingError("Enter an amount above zero.");
  return db().transaction(async (tx) => {
    const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, input.statementId)).for("update");
    if (!st || st.status === "VOID") throw new BillingError("Statement not found.");
    const [seller] = await tx
      .update(sellerProfiles)
      .set({ nextCreditNoteNumber: sql`${sellerProfiles.nextCreditNoteNumber} + 1` })
      .where(eq(sellerProfiles.id, st.sellerProfileId))
      .returning({ n: sellerProfiles.nextCreditNoteNumber, prefix: sellerProfiles.statementPrefix });
    const number = `${seller!.prefix}-CN-${manilaDate().slice(0, 4)}-${String(seller!.n - 1).padStart(6, "0")}`;
    const [cn] = await tx.insert(creditNotes).values({ organizationId: st.organizationId, statementId: st.id, number, amountCentavos: input.amountCentavos, reason: input.reason, createdBy: staffId }).returning();
    const credited = st.creditedCentavos + input.amountCentavos;
    const settled = st.paidCentavos + st.withheldCentavos + credited >= st.totalCentavos;
    await tx.update(billingStatements).set({ creditedCentavos: credited, status: settled ? "PAID" : st.status, paidAt: settled && !st.paidAt ? new Date() : st.paidAt }).where(eq(billingStatements.id, st.id));
    await audit({ organizationId: st.organizationId, actorId: staffId, actorKind: "staff", action: "credit_note.issued", entity: "credit_note", entityId: cn!.id, after: { number, amount: input.amountCentavos, reason: input.reason } }, tx);
    if (settled && st.status !== "PAID") {
      await onStatementPaid(st.id, tx);
      await publishPaid(st.id, tx);
    }
    return cn!;
  });
}

export async function recordRefund(staffId: string, input: { statementId: string; amountCentavos: number; reason: string; reference: string }) {
  if (!input.reason.trim()) throw new BillingError("A reason is required.");
  const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, input.statementId));
  if (!st || input.amountCentavos <= 0 || input.amountCentavos > st.paidCentavos) throw new BillingError("A refund cannot be more than was paid.");
  await db().transaction(async (tx) => {
    await tx.insert(payments).values({ organizationId: st.organizationId, statementId: st.id, method: "CREDIT", kind: "REFUND", amountCentavos: -input.amountCentavos, idempotencyKey: `refund:${st.id}:${input.reference}`, reference: input.reference, recordedBy: staffId, paidAt: new Date() });
    await tx.update(billingStatements).set({ paidCentavos: st.paidCentavos - input.amountCentavos }).where(eq(billingStatements.id, st.id));
    await audit({ organizationId: st.organizationId, actorId: staffId, actorKind: "staff", action: "refund.recorded", entity: "billing_statement", entityId: st.id, after: input }, tx);
  });
}

export async function voidStatement(staffId: string, statementId: string, reason: string) {
  const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, statementId));
  if (!st || st.paidCentavos > 0 || st.status === "PAID") throw new BillingError("Only an unpaid statement can be voided. Use a credit note instead.");
  await db().update(billingStatements).set({ status: "VOID", voidReason: reason }).where(eq(billingStatements.id, st.id));
  await audit({ organizationId: st.organizationId, actorId: staffId, actorKind: "staff", action: "statement.voided", entity: "billing_statement", entityId: st.id, after: { reason } });
}

/** CR-01 fallback: staff write the BIR invoice number issued by Sentire's registered system. */
export async function recordInvoiceNumber(actorId: string | null, statementId: string, invoiceNumber: string) {
  const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, statementId));
  if (!st || st.status !== "PAID") throw new BillingError("Only a paid statement gets an invoice number.");
  await db().update(billingStatements).set({ birInvoiceNumber: invoiceNumber.trim(), birInvoiceRecordedAt: new Date() }).where(eq(billingStatements.id, st.id));
  await audit({ organizationId: st.organizationId, actorId, actorKind: actorId ? "staff" : "app", action: "statement.invoice_number_recorded", entity: "billing_statement", entityId: st.id, after: { invoiceNumber } });
}
