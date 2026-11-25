import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { billingStatements, checkoutSessions, dunningSteps, events, outboundEmails, payments, plans, statementLines, subscriptions, users, withholdings, sellerProfiles } from "@/server/db/schema";
import { seedCatalog } from "@/server/billing/catalog";
import { changePlan, quote, setCancelAtPeriodEnd, subscribe } from "@/server/billing/subscriptions";
import { handleWebhook, issueCreditNote, recordBankTransfer, recordInvoiceNumber, startCheckout } from "@/server/billing/payments";
import { billingDaily, closePeriods, issueRenewals, runDunning } from "@/server/billing/daily";
import { testSignature } from "@/server/billing/providers/test";
import { createOrganization } from "@/server/account/orgs";
import { signUp } from "@/server/account/service";
import { orgContext, type OrgContext } from "@/server/db/dal";
import { addDays, manilaDate } from "@/lib/time";
import { pgError, resetDb } from "../helpers";

async function setup(): Promise<{ ctx: OrgContext; orgId: string; plan: (code: string) => Promise<string> }> {
  await seedCatalog();
  await signUp({ name: "Owner One", email: "owner@x.ph", password: "a-long-safe-passphrase", acceptTerms: true, marketing: false });
  const [u] = await db().select().from(users);
  const org = await createOrganization(u!.id, { registeredName: "Dela Cruz Trading Inc.", tin: "123456789", address: "Marikina City", vatStatus: "NON_VAT", billingEmail: "billing@delacruz.ph" }, ["ledger"]);
  return {
    ctx: orgContext({ organizationId: org.id, actorId: u!.id }),
    orgId: org.id,
    plan: async (code) => (await db().select().from(plans).where(eq(plans.code, code)))[0]!.id,
  };
}

async function pay(ctx: OrgContext, statementId: string, opts: { atc?: string; eventId?: string } = {}) {
  await startCheckout(ctx, statementId, { atc: opts.atc ?? null });
  const [cs] = await db().select().from(checkoutSessions).where(and(eq(checkoutSessions.statementId, statementId), eq(checkoutSessions.status, "PENDING")));
  const body = JSON.stringify({ id: opts.eventId ?? `evt_${cs!.id}`, type: "paid", ref: cs!.providerRef, amount: cs!.amountCentavos, method: "GCASH" });
  return handleWebhook("test", new Headers({ "x-test-signature": testSignature(body) }), body);
}

async function sub(orgId: string) {
  return (await db().select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)))[0]!;
}

beforeEach(resetDb);

describe("UC-04 subscribe and pay", () => {
  it("quotes Ledger Team yearly with the setup fee", async () => {
    const { plan } = await setup();
    const q = await quote(await plan("team"), "ANNUAL");
    expect(q.lines.map((l) => [l.kind, l.unitCentavos])).toEqual([["SETUP_FEE", 1000000], ["PLAN", 399000 * 12]]);
    await expect(quote(await plan("team"), "MONTHLY")).rejects.toThrow(/not sold monthly/);
  });

  it("creates a Pending subscription and statement, activates on a signed webhook, ignores duplicates", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    expect(statement.number).toMatch(/^SC-\d{4}-000001$/);
    expect(statement.totalCentavos).toBe(500000 + 149000 * 12);
    expect(statement.taxCentavos).toBe(0); // non-VAT seller
    expect((await sub(orgId)).status).toBe("PENDING");
    await expect(subscribe(ctx, { planId: await plan("team"), cycle: "ANNUAL", method: "ONLINE" })).rejects.toThrow(/already has/);

    expect((await pay(ctx, statement.id, { eventId: "evt-1" })).duplicate).toBe(false);
    const s = await sub(orgId);
    expect(s.status).toBe("ACTIVE");
    expect(s.currentPeriodStart).toBe(manilaDate());
    const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, statement.id));
    expect(st!.status).toBe("PAID");
    // the same provider event again changes nothing
    const [cs] = await db().select().from(checkoutSessions);
    const body = JSON.stringify({ id: "evt-1", type: "paid", ref: cs!.providerRef, amount: cs!.amountCentavos });
    expect((await handleWebhook("test", new Headers({ "x-test-signature": testSignature(body) }), body)).duplicate).toBe(true);
    expect(await db().select().from(payments)).toHaveLength(1);
    expect((await db().select().from(events)).map((e) => e.type)).toEqual(expect.arrayContaining(["billing.statement.paid", "billing.subscription.changed"]));
  });

  it("rejects a webhook with a bad signature", async () => {
    await setup();
    await expect(handleWebhook("test", new Headers({ "x-test-signature": "nope" }), "{}")).rejects.toThrow(/signature/);
  });

  it("applies VAT as 12/112 of the total for a VAT-registered seller", async () => {
    const { ctx, plan } = await setup();
    await db().update(sellerProfiles).set({ taxStatus: "VAT" });
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    expect(statement.taxCentavos).toBe(Math.round((2288000 * 12) / 112));
    expect(statement.subtotalCentavos + statement.taxCentavos).toBe(statement.totalCentavos);
  });

  it("keeps issued statements and payments unchangeable", async () => {
    const { ctx, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    expect(await pgError(db().update(billingStatements).set({ totalCentavos: 1 }).where(eq(billingStatements.id, statement.id)))).toMatch(/cannot change/);
    expect(await pgError(db().delete(billingStatements).where(eq(billingStatements.id, statement.id)))).toMatch(/cannot be deleted/);
    expect(await pgError(db().delete(statementLines))).toMatch(/append-only/);
  });

  it("bank transfer: statement due in 7 days, staff record the transfer with 2% withholding", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "BANK_TRANSFER" });
    expect(statement.dueDate).toBe(addDays(manilaDate(), 7));
    expect((await db().select().from(outboundEmails)).some((m) => m.template === "statement")).toBe(true);
    const withheld = Math.round(statement.totalCentavos * 0.02);
    await recordBankTransfer("staff-1", { statementId: statement.id, amountCentavos: statement.totalCentavos - withheld, reference: "BPI-001", atc: "WC160" });
    expect((await sub(orgId)).status).toBe("ACTIVE");
    const [w] = await db().select().from(withholdings);
    expect(w).toMatchObject({ atc: "WC160", amountCentavos: withheld, status: "PENDING" });
    await recordInvoiceNumber("staff-1", statement.id, "INV-0001");
  });

  it("online payment net of withholding settles the statement", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(ctx, statement.id, { atc: "WC160" });
    const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, statement.id));
    expect(st!.status).toBe("PAID");
    expect(st!.withheldCentavos).toBe(Math.round(st!.totalCentavos * 0.02));
    expect((await sub(orgId)).status).toBe("ACTIVE");
  });
});

describe("UC-05 change plan", () => {
  it("upgrades with a prorated charge and switches the plan when paid; downgrades at renewal", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(ctx, statement.id);
    // Move the period so half of it is left: start 182 days ago.
    const start = addDays(manilaDate(), -182);
    const end = addDays(start, 365);
    await db().update(subscriptions).set({ currentPeriodStart: start, currentPeriodEnd: end });
    const r = await changePlan(ctx, (await sub(orgId)).id, { planId: await plan("team") });
    expect(r.mode).toBe("upgrade");
    const remaining = 365 - 182;
    const expected = Math.floor(((399000 - 149000) * 12 * remaining) / 365 + 0.5);
    const lines = await db().select().from(statementLines).where(eq(statementLines.statementId, r.statement!.id));
    expect(lines.find((l) => l.kind === "PRORATION")!.amountCentavos).toBe(expected);
    expect(lines.find((l) => l.kind === "SETUP_FEE")!.amountCentavos).toBe(500000);
    expect((await sub(orgId)).planId).toBe(await plan("solo"));
    await pay(ctx, r.statement!.id);
    expect((await sub(orgId)).planId).toBe(await plan("team"));

    const d = await changePlan(ctx, (await sub(orgId)).id, { planId: await plan("solo") });
    expect(d.mode).toBe("scheduled");
    expect((await sub(orgId)).scheduledPlanId).toBe(await plan("solo"));
  });
});

describe("UC-06 and UC-07 renewal and dunning", () => {
  async function activeEndingIn(days: number) {
    const s = await setup();
    const { statement } = await subscribe(s.ctx, { planId: await s.plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(s.ctx, statement.id);
    const end = addDays(manilaDate(), days);
    await db().update(subscriptions).set({ currentPeriodStart: addDays(end, -365), currentPeriodEnd: end });
    return s;
  }

  it("issues the renewal statement 7 days before the end, once", async () => {
    const { orgId } = await activeEndingIn(7);
    expect(await issueRenewals()).toBe(1);
    expect(await issueRenewals()).toBe(0);
    const r = (await db().select().from(billingStatements).where(and(eq(billingStatements.organizationId, orgId), eq(billingStatements.kind, "RENEWAL"))))[0]!;
    expect(r.dueDate).toBe(addDays(manilaDate(), 7));
    expect(r.totalCentavos).toBe(149000 * 12); // no setup fee on renewal
  });

  it("rolls into the next period when the renewal was paid", async () => {
    const { ctx, orgId } = await activeEndingIn(5);
    await issueRenewals();
    const r = (await db().select().from(billingStatements).where(eq(billingStatements.kind, "RENEWAL")))[0]!;
    await pay(ctx, r.id);
    const now = new Date(Date.now() + 6 * 86_400_000);
    await closePeriods(now);
    const s = await sub(orgId);
    expect(s.status).toBe("ACTIVE");
    expect(s.currentPeriodStart).toBe(addDays(manilaDate(), 5));
  });

  it("reminds on days 0, 3 and 7, suspends on day 8, reactivates on payment", async () => {
    const { ctx, orgId } = await activeEndingIn(1);
    await issueRenewals();
    const at = (d: number) => new Date(Date.now() + (1 + d) * 86_400_000 + 3600_000);
    await closePeriods(at(0));
    expect((await sub(orgId)).status).toBe("PAST_DUE");
    for (const d of [0, 3, 7]) await runDunning(at(d));
    await runDunning(at(7));
    expect((await db().select().from(dunningSteps)).map((x) => x.dayOffset).sort((a, b) => a - b)).toEqual([0, 3, 7]);
    await runDunning(at(8));
    expect((await sub(orgId)).status).toBe("SUSPENDED");
    const r = (await db().select().from(billingStatements).where(eq(billingStatements.kind, "RENEWAL")))[0]!;
    await pay(ctx, r.id);
    const s = await sub(orgId);
    expect(s.status).toBe("ACTIVE");
    expect(s.currentPeriodStart).toBe(addDays(manilaDate(), 1));
  });

  it("cancels on day 30 when nothing is paid, and staff grace postpones suspension", async () => {
    const { orgId } = await activeEndingIn(1);
    await issueRenewals();
    const at = (d: number) => new Date(Date.now() + (1 + d) * 86_400_000 + 3600_000);
    await closePeriods(at(0));
    await db().update(subscriptions).set({ graceUntil: manilaDate(at(10)) });
    await runDunning(at(8));
    expect((await sub(orgId)).status).toBe("PAST_DUE");
    await db().update(subscriptions).set({ graceUntil: null });
    await runDunning(at(30));
    expect((await sub(orgId)).status).toBe("CANCELLED");
  });

  it("cancel at period end ends the subscription without a renewal", async () => {
    const { ctx, orgId } = await activeEndingIn(3);
    await setCancelAtPeriodEnd(ctx, (await sub(orgId)).id, true);
    await billingDaily(new Date(Date.now() + 4 * 86_400_000));
    expect((await sub(orgId)).status).toBe("CANCELLED");
    expect(await db().select().from(billingStatements).where(eq(billingStatements.kind, "RENEWAL"))).toHaveLength(0);
  });

  it("closes an unpaid online request after 24 hours", async () => {
    const { ctx, orgId, plan } = await setup();
    await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await billingDaily(new Date(Date.now() + 25 * 3600_000));
    expect((await sub(orgId)).status).toBe("EXPIRED");
  });
});

describe("FR-20 credit notes", () => {
  it("a credit note settles the balance and is numbered", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    const cn = await issueCreditNote("staff-1", { statementId: statement.id, amountCentavos: statement.totalCentavos, reason: "Launch waiver" });
    expect(cn.number).toMatch(/^SC-CN-\d{4}-000001$/);
    expect((await sub(orgId)).status).toBe("ACTIVE");
  });
});
