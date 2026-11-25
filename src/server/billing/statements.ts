import { and, eq, sql } from "drizzle-orm";
import { db, type DBorTx } from "../db/client";
import { billingStatements, organizations, sellerProfiles, statementLines } from "../db/schema";
import { mulDiv, sum } from "@/lib/money";
import { audit } from "../audit";

export interface LineInput {
  kind: "SETUP_FEE" | "PLAN" | "ADD_ON" | "USAGE" | "PRORATION" | "ADJUSTMENT";
  description: string;
  quantity?: number;
  unitCentavos: number;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  priceId?: string | null;
}

export class BillingError extends Error {}

export function isProductionSeller() {
  return process.env.NODE_ENV === "production" && process.env.SENTIRE_ENV !== "staging";
}

/** Next number in the seller's series, e.g. SC-2026-000123. */
async function nextNumber(sellerId: string, issueDate: string, tx: DBorTx) {
  const [r] = await tx
    .update(sellerProfiles)
    .set({ nextStatementNumber: sql`${sellerProfiles.nextStatementNumber} + 1` })
    .where(eq(sellerProfiles.id, sellerId))
    .returning({ n: sellerProfiles.nextStatementNumber, prefix: sellerProfiles.statementPrefix });
  return `${r!.prefix}-${issueDate.slice(0, 4)}-${String(r!.n - 1).padStart(6, "0")}`;
}

/**
 * Create a billing statement with its lines (FR-15). Catalog prices are final prices.
 * VAT seller: VAT is 12/112 of the total and shown separately. Non-VAT seller: no VAT line (CR-02).
 */
export async function createStatement(
  input: {
    organizationId: string;
    sellerProfileId: string;
    subscriptionId?: string | null;
    kind: "INITIAL" | "RENEWAL" | "CHANGE" | "ADJUSTMENT";
    issueDate: string;
    dueDate: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    lines: LineInput[];
    actorId?: string | null;
  },
  tx: DBorTx,
) {
  const [seller] = await tx.select().from(sellerProfiles).where(eq(sellerProfiles.id, input.sellerProfileId));
  if (!seller) throw new BillingError("Seller not found.");
  if (!seller.confirmed && isProductionSeller()) throw new BillingError("The seller's registered details are not confirmed yet.");
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, input.organizationId));
  const lines = input.lines.map((l) => ({ ...l, quantity: l.quantity ?? 1, amountCentavos: (l.quantity ?? 1) * l.unitCentavos }));
  const total = sum(lines.map((l) => l.amountCentavos));
  const tax = seller.taxStatus === "VAT" ? mulDiv(total, 12, 112) : 0;
  const number = await nextNumber(seller.id, input.issueDate, tx);
  const [st] = await tx
    .insert(billingStatements)
    .values({
      organizationId: input.organizationId,
      sellerProfileId: seller.id,
      subscriptionId: input.subscriptionId ?? null,
      number,
      kind: input.kind,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      subtotalCentavos: total - tax,
      taxCentavos: tax,
      totalCentavos: total,
      status: total <= 0 ? "PAID" : "OPEN",
      paidAt: total <= 0 ? new Date() : null,
      sellerSnapshot: { registeredName: seller.registeredName, tradeName: seller.tradeName, tin: seller.tin, branchCode: seller.branchCode, address: seller.address, taxStatus: seller.taxStatus, confirmed: seller.confirmed, bankDetails: seller.bankDetails },
      buyerSnapshot: { registeredName: org!.registeredName, tradeName: org!.tradeName, tin: org!.tin, branchCode: org!.branchCode, address: org!.address, vatStatus: org!.vatStatus, billingEmail: org!.billingEmail },
    })
    .returning();
  if (lines.length)
    await tx.insert(statementLines).values(
      lines.map((l) => ({
        statementId: st!.id,
        organizationId: input.organizationId,
        kind: l.kind,
        description: l.description,
        quantity: l.quantity,
        unitCentavos: l.unitCentavos,
        amountCentavos: l.amountCentavos,
        servicePeriodStart: l.servicePeriodStart ?? null,
        servicePeriodEnd: l.servicePeriodEnd ?? null,
        priceId: l.priceId ?? null,
      })),
    );
  await audit({ organizationId: input.organizationId, actorId: input.actorId ?? null, actorKind: input.actorId ? "user" : "system", action: "statement.issued", entity: "billing_statement", entityId: st!.id, after: { number, total, kind: input.kind } }, tx);
  return st!;
}

export function balance(st: { totalCentavos: number; paidCentavos: number; withheldCentavos: number; creditedCentavos: number }) {
  return st.totalCentavos - st.paidCentavos - st.withheldCentavos - st.creditedCentavos;
}

export async function statementWithLines(organizationId: string, statementId: string) {
  const [st] = await db().select().from(billingStatements).where(and(eq(billingStatements.organizationId, organizationId), eq(billingStatements.id, statementId)));
  if (!st) return null;
  const lines = await db().select().from(statementLines).where(eq(statementLines.statementId, st.id)).orderBy(statementLines.createdAt);
  return { st, lines };
}
