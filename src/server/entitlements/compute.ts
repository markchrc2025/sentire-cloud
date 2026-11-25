import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, type DBorTx } from "../db/client";
import { addOns, entitlementOverrides, entitlements, featureGrants, plans, products, subscriptionItems, subscriptions, type EntFeature, type EntLimit } from "../db/schema";
import { publish } from "../hub/publish";
import { audit } from "../audit";
import { manilaDate } from "@/lib/time";

const STATE: Record<string, "ACTIVE" | "READ_ONLY" | "OFF"> = { PENDING: "OFF", ACTIVE: "ACTIVE", PAST_DUE: "ACTIVE", SUSPENDED: "READ_ONLY", CANCELLED: "OFF", EXPIRED: "OFF" };

const LIMIT_KEYS: Record<string, string> = { users: "users", companies: "companies", branches: "branches", invoicesPerMonth: "invoices_per_month" };

export interface Computed {
  state: "ACTIVE" | "READ_ONLY" | "OFF";
  planCode: string | null;
  addOns: string[];
  limits: Record<string, EntLimit>;
  features: EntFeature[];
  subscriptionId: string | null;
  periodEnd: string | null;
}

/** System Design 6.2 and FR-24, FR-45: subscription state, plan, add-ons, feature grants and staff overrides. */
export async function computeEntitlement(organizationId: string, appId: string, tx: DBorTx = db()): Promise<Computed> {
  const subs = await tx
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(products, eq(products.id, subscriptions.productId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.organizationId, organizationId), eq(products.appId, appId)))
    .orderBy(desc(subscriptions.createdAt));
  const live = subs.find((s) => ["ACTIVE", "PAST_DUE", "SUSPENDED"].includes(s.sub.status)) ?? null;
  const out: Computed = { state: "OFF", planCode: null, addOns: [], limits: {}, features: [], subscriptionId: null, periodEnd: null };
  if (live) {
    out.state = STATE[live.sub.status]!;
    out.planCode = live.plan.code;
    out.subscriptionId = live.sub.id;
    out.periodEnd = live.sub.currentPeriodEnd;
    for (const [k, v] of Object.entries(live.plan.limits ?? {})) if (LIMIT_KEYS[k]) out.limits[LIMIT_KEYS[k]!] = { value: v ?? null, mode: "HARD" };
    const items = await tx
      .select({ addOn: addOns })
      .from(subscriptionItems)
      .innerJoin(addOns, eq(addOns.id, subscriptionItems.addOnId))
      .where(and(eq(subscriptionItems.subscriptionId, live.sub.id), eq(subscriptionItems.kind, "ADD_ON"), eq(subscriptionItems.active, true)));
    out.addOns = items.map((i) => i.addOn.code);
    const grants = await tx
      .select()
      .from(featureGrants)
      .where(or(eq(featureGrants.planId, live.plan.id), items.length ? inArray(featureGrants.addOnId, items.map((i) => i.addOn.id)) : eq(featureGrants.id, "__none__")));
    for (const g of grants) {
      out.features.push({ key: g.featureKey, source: g.planId ? "PLAN" : "ADD_ON", limit: g.limit, mode: g.limitMode });
      if (g.limit !== null) out.limits[g.featureKey] = { value: g.limit, mode: g.limitMode };
    }
  }
  const overrides = await tx
    .select()
    .from(entitlementOverrides)
    .where(and(eq(entitlementOverrides.organizationId, organizationId), eq(entitlementOverrides.appId, appId), or(isNull(entitlementOverrides.expiresAt), gt(entitlementOverrides.expiresAt, new Date()))));
  for (const o of overrides) {
    if (o.forceState) out.state = o.forceState;
    for (const k of o.features) if (!out.features.some((f) => f.key === k)) out.features.push({ key: k, source: "OVERRIDE" });
    Object.assign(out.limits, o.limits);
  }
  out.features.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function same(a: Computed, b: typeof entitlements.$inferSelect) {
  return (
    a.state === b.state &&
    a.planCode === b.planCode &&
    a.periodEnd === b.periodEnd &&
    JSON.stringify(a.addOns) === JSON.stringify(b.addOns) &&
    JSON.stringify(a.limits) === JSON.stringify(b.limits) &&
    JSON.stringify(a.features) === JSON.stringify(b.features)
  );
}

/** Recompute, store with a new version when anything changed, and publish account.entitlement.changed (FR-25). */
export async function refreshEntitlement(organizationId: string, appId: string, tx: DBorTx = db()) {
  const c = await computeEntitlement(organizationId, appId, tx);
  const [cur] = await tx.select().from(entitlements).where(and(eq(entitlements.organizationId, organizationId), eq(entitlements.appId, appId)));
  if (cur && same(c, cur)) return cur;
  if (!cur && c.state === "OFF" && !c.features.length) return null;
  const version = (cur?.version ?? 0) + 1;
  const values = { organizationId, appId, ...c, version, computedAt: new Date() };
  const [row] = cur
    ? await tx.update(entitlements).set(values).where(eq(entitlements.id, cur.id)).returning()
    : await tx.insert(entitlements).values(values).returning();
  await audit({ organizationId, actorKind: "system", action: "entitlement.changed", entity: "entitlement", entityId: row!.id, before: cur ?? null, after: row }, tx);
  await publish("account.entitlement.changed", organizationId, toPublic(row!), tx);
  return row!;
}

export async function refreshAllForOrg(organizationId: string, tx: DBorTx = db()) {
  const apps = await tx.selectDistinct({ appId: products.appId }).from(products);
  for (const a of apps) await refreshEntitlement(organizationId, a.appId, tx);
}

export type PublicEntitlement = ReturnType<typeof toPublic>;
export function toPublic(e: typeof entitlements.$inferSelect) {
  return {
    organizationId: e.organizationId,
    appId: e.appId,
    state: e.state,
    plan: e.planCode,
    addons: e.addOns,
    features: e.features,
    limits: e.limits,
    periodEnd: e.periodEnd,
    version: e.version,
    computedAt: e.computedAt.toISOString(),
    asOf: manilaDate(),
  };
}

export async function getEntitlement(organizationId: string, appId: string) {
  const [e] = await db().select().from(entitlements).where(and(eq(entitlements.organizationId, organizationId), eq(entitlements.appId, appId)));
  return e ?? null;
}
