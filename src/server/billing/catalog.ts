import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db, type DBorTx } from "../db/client";
import { addOns, featureGrants, features, plans, prices, products, sellerProfiles, type PlanLimits } from "../db/schema";
import { manilaDate } from "@/lib/time";

/**
 * Catalog content at launch (Blueprint 6.2): Ledger plans as decided on 9 Nov 2026, billed annually.
 * Limits match Ledger's tiers (ph_cas/hosting/tiers.py); null = unlimited.
 * The seller profile holds placeholders until staff enter Sentire's registered details (confirmed=false blocks statements).
 */
export const LEDGER_PLANS: { code: string; name: string; rank: number; monthly: number; setup: number; limits: PlanLimits; summary: string }[] = [
  { code: "solo", name: "Solo", rank: 10, monthly: 149000, setup: 500000, limits: { users: 1, companies: 1, branches: 1, invoicesPerMonth: 150 }, summary: "One user, one company, up to 150 invoices a month." },
  { code: "team", name: "Team", rank: 20, monthly: 399000, setup: 1000000, limits: { users: 5, companies: 1, branches: 3, invoicesPerMonth: 1000 }, summary: "Up to 5 users, one company with up to 3 branches, up to 1,000 invoices a month." },
  { code: "business", name: "Business", rank: 30, monthly: 999000, setup: 2500000, limits: { users: 15, companies: 1, branches: null, invoicesPerMonth: null }, summary: "Up to 15 users, one company, any number of branches and invoices." },
  { code: "enterprise", name: "Enterprise", rank: 40, monthly: 2499000, setup: 7500000, limits: { users: null, companies: null, branches: null, invoicesPerMonth: null }, summary: "No limits on users, companies, branches or invoices. From this price; dedicated hosting on request." },
];

export async function seedCatalog() {
  await db()
    .insert(sellerProfiles)
    .values({ code: "sentire", registeredName: "Sentire Solutions (to be confirmed)", tin: "000000000", address: "Marikina City, Metro Manila (to be confirmed)", taxStatus: "NON_VAT", statementPrefix: "SC", confirmed: false })
    .onConflictDoNothing();
  const [seller] = await db().select().from(sellerProfiles).where(eq(sellerProfiles.code, "sentire"));
  await db()
    .insert(products)
    .values({ code: "ledger", name: "Sentire Ledger", appId: "ledger", sellerProfileId: seller!.id, description: "Accounting for Philippine businesses, BIR-ready." })
    .onConflictDoNothing();
  const [ledger] = await db().select().from(products).where(eq(products.code, "ledger"));
  for (const p of LEDGER_PLANS) {
    const existing = await db().select().from(plans).where(and(eq(plans.productId, ledger!.id), eq(plans.code, p.code)));
    if (existing.length) continue;
    const [plan] = await db().insert(plans).values({ productId: ledger!.id, code: p.code, name: p.name, rank: p.rank, limits: p.limits, summary: p.summary, pilotDays: 14 }).returning();
    await db().insert(prices).values({ planId: plan!.id, cycle: "ANNUAL", amountCentavos: p.monthly * 12, setupFeeCentavos: p.setup, validFrom: "2026-11-01" });
  }
  await db()
    .insert(features)
    .values({ key: "ai.assistant", name: "AI assistant", benefit: "Ask questions about your data and let AI read documents for you.", productCode: null, limitUnit: "requests a month" })
    .onConflictDoNothing();
  // The AI assistant add-on exists but is not on sale until its price is set (owner decision 6).
  await db()
    .insert(addOns)
    .values({ code: "ai-assistant", name: "AI assistant", productId: null, minPlanRank: 0, onSale: false, benefit: "Always-on AI help and document reading, with a monthly allowance." })
    .onConflictDoNothing();
  const [ai] = await db().select().from(addOns).where(eq(addOns.code, "ai-assistant"));
  const g = await db().select().from(featureGrants).where(and(eq(featureGrants.featureKey, "ai.assistant"), eq(featureGrants.addOnId, ai!.id)));
  if (!g.length) await db().insert(featureGrants).values({ featureKey: "ai.assistant", addOnId: ai!.id, limit: 500, limitMode: "HARD" });
}

/** The price valid on a date (newest first). */
export async function priceFor(ref: { planId?: string; addOnId?: string }, cycle: "MONTHLY" | "ANNUAL" | "ONE_TIME", on = manilaDate(), tx: DBorTx = db()) {
  const owner = ref.planId ? eq(prices.planId, ref.planId) : eq(prices.addOnId, ref.addOnId!);
  const rows = await tx
    .select()
    .from(prices)
    .where(and(owner, eq(prices.cycle, cycle), lte(prices.validFrom, on), or(isNull(prices.validTo), gte(prices.validTo, on))))
    .orderBy(prices.validFrom);
  return rows.at(-1) ?? null;
}

export async function catalogFor(productCode: string) {
  const [product] = await db().select().from(products).where(eq(products.code, productCode));
  if (!product) return null;
  const ps = await db().select().from(plans).where(and(eq(plans.productId, product.id), eq(plans.onSale, true))).orderBy(plans.rank);
  const out = [];
  for (const p of ps) {
    out.push({ plan: p, annual: await priceFor({ planId: p.id }, "ANNUAL"), monthly: await priceFor({ planId: p.id }, "MONTHLY") });
  }
  const extras = (await db().select().from(addOns).where(eq(addOns.onSale, true))).filter((a) => !a.productId || a.productId === product.id);
  return { product, plans: out, addOns: extras };
}
