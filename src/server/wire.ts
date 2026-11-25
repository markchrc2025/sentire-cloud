import { shared } from "./shared";
/**
 * Connects the modules through their hooks. Imported once by the server, the worker and the tests.
 * Phase 1 code (sign-in, members) and Phase 2 code (billing) stay unaware of entitlements.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import { appAccess, memberships, products, subscriptions } from "./db/schema";
import { billingHooks } from "./billing/hooks";
import { getEntitlement, refreshEntitlement, toPublic } from "./entitlements/compute";
import { setEntitlementClaim } from "./oidc/provider";
import { setEntitlementGate } from "./oidc";
import { setSeatCheck } from "./account/orgs";
import { setLauncherExtras } from "./account/launcher";
import { setUsageText } from "./billing/page-extras";
import { usageLines } from "./entitlements/usage";
import { listApps } from "./account/registry";
import "./hub/deliver";
import { instanceFor, onActivated, onCancelled } from "./hosting/instances";

const state = shared("wired", () => ({ done: false }));
export function wire() {
  if (state.done) return;
  state.done = true;

  billingHooks.onActivated.push(onActivated);
  billingHooks.onCancelled.push(onCancelled);

  billingHooks.onSubscriptionChanged.push(async (organizationId, subscriptionId, tx) => {
    const [row] = await tx.select({ appId: products.appId }).from(subscriptions).innerJoin(products, eq(products.id, subscriptions.productId)).where(eq(subscriptions.id, subscriptionId));
    if (row) await refreshEntitlement(organizationId, row.appId, tx);
  });

  setEntitlementClaim(async (organizationId, appId) => {
    const e = await getEntitlement(organizationId, appId);
    if (!e) return { state: "OFF", plan: null, addons: [], features: [], limits: {}, version: 0 };
    const p = toPublic(e);
    return { state: p.state, plan: p.plan, addons: p.addons, features: p.features.map((f) => f.key), limits: p.limits, version: p.version };
  });

  // Apps with no product in the catalog (for example a test app) are not gated by billing.
  setEntitlementGate(async (organizationId, appId) => {
    const [product] = await db().select().from(products).where(eq(products.appId, appId));
    if (!product) return "ACTIVE";
    return (await getEntitlement(organizationId, appId))?.state ?? "OFF";
  });

  // UC-03 step 2: seat limits per app (members with access count as users).
  setSeatCheck(async (ctx, appIds, extra) => {
    const over: string[] = [];
    for (const appId of appIds) {
      const e = await getEntitlement(ctx.organizationId, appId);
      const lim = e?.limits.users;
      if (!lim || lim.value === null || lim.mode !== "HARD") continue;
      const [r] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(appAccess)
        .innerJoin(memberships, eq(memberships.id, appAccess.membershipId))
        .where(and(eq(appAccess.organizationId, ctx.organizationId), eq(appAccess.appId, appId), eq(appAccess.allowed, true), eq(memberships.status, "ACTIVE")));
      if ((r?.n ?? 0) + extra > lim.value) over.push(appId);
    }
    return over;
  });

  setLauncherExtras(async (organizationId) => {
    const out: Record<string, { label?: string; open?: boolean; url?: string; cta?: { label: string; href: string } }> = {};
    const prods = await db().select().from(products);
    const apps = await listApps();
    for (const a of apps) {
      if (!prods.some((p) => p.appId === a.appId)) continue;
      const e = await getEntitlement(organizationId, a.appId);
      if (!e || e.state === "OFF") out[a.appId] = { label: "Not subscribed.", open: false, cta: { label: "See plans", href: `/org/billing/subscribe?product=${prods.find((p) => p.appId === a.appId)!.code}` } };
      else if (e.state === "READ_ONLY") out[a.appId] = { label: "Read-only until the overdue statement is paid.", open: true };
      else {
        const inst = await instanceFor(organizationId, a.appId);
        if (inst && inst.status !== "ACTIVE") out[a.appId] = { label: "Setting up your app. We will email you when it is ready.", open: false };
        else out[a.appId] = { label: `${e.planCode ? e.planCode[0]!.toUpperCase() + e.planCode.slice(1) : ""} plan, active.`, url: inst?.baseUrl ?? undefined };
      }
    }
    return out;
  });

  setUsageText(usageLines);
}

export async function refreshEverything() {
  const subs = await db()
    .select({ id: subscriptions.id, status: subscriptions.status, org: subscriptions.organizationId, app: products.appId })
    .from(subscriptions)
    .innerJoin(products, eq(products.id, subscriptions.productId))
    .where(inArray(subscriptions.status, ["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]));
  for (const s of subs) {
    await refreshEntitlement(s.org, s.app);
    // A paid subscription always has an instance (idempotent).
    if (s.status === "ACTIVE" && !(await instanceFor(s.org, s.app))) await onActivated(s.org, s.id);
  }
}
