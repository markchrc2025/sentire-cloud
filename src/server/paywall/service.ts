import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { addOns, featureGrants, features, memberships, organizations, paywallEvents, plans, products, subscriptions, upgradeRequests, users } from "../db/schema";
import { inOrg, type OrgContext } from "../db/dal";
import { requireRole, membershipOf } from "../account/orgs";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { sendMail } from "../mail/send";
import { env } from "@/lib/env";
import { formatPHP } from "@/lib/money";
import { priceFor } from "../billing/catalog";
import { getEntitlement } from "../entitlements/compute";

export interface UnlockOption {
  kind: "PLAN" | "ADD_ON";
  id: string;
  code: string;
  name: string;
  priceCentavos: number;
  cycle: "ANNUAL" | "MONTHLY";
}

/**
 * Cheapest plan or add-on that unlocks a feature (or a plan limit such as "users") for an organization and app.
 * Plans are compared by yearly price; add-ons must fit the current plan rank.
 */
export async function cheapestUnlock(organizationId: string, appId: string, featureKey: string): Promise<UnlockOption | null> {
  const [product] = await db().select().from(products).where(eq(products.appId, appId));
  const [live] = product
    ? await db()
        .select({ sub: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.productId, product.id), inArray(subscriptions.status, ["ACTIVE", "PAST_DUE", "SUSPENDED"])))
    : [];
  const options: UnlockOption[] = [];
  const grants = await db().select().from(featureGrants).where(eq(featureGrants.featureKey, featureKey));
  for (const g of grants) {
    if (g.addOnId) {
      const [a] = await db().select().from(addOns).where(and(eq(addOns.id, g.addOnId), eq(addOns.onSale, true)));
      if (!a || (a.productId && product && a.productId !== product.id) || (live && live.plan.rank < a.minPlanRank)) continue;
      const p = (await priceFor({ addOnId: a.id }, live?.sub.cycle ?? "ANNUAL")) ?? (await priceFor({ addOnId: a.id }, "MONTHLY"));
      if (p) options.push({ kind: "ADD_ON", id: a.id, code: a.code, name: a.name, priceCentavos: p.amountCentavos, cycle: p.cycle as "ANNUAL" | "MONTHLY" });
    }
    if (g.planId) {
      const [pl] = await db().select().from(plans).where(and(eq(plans.id, g.planId), eq(plans.onSale, true)));
      if (!pl || (live && pl.rank <= live.plan.rank)) continue;
      const p = await priceFor({ planId: pl.id }, "ANNUAL");
      if (p) options.push({ kind: "PLAN", id: pl.id, code: pl.code, name: pl.name, priceCentavos: p.amountCentavos, cycle: "ANNUAL" });
    }
  }
  // Plan limits (users, branches, invoices a month): the next plan with a higher or unlimited limit.
  if (!grants.length && product) {
    const keyMap: Record<string, string> = { users: "users", companies: "companies", branches: "branches", invoices_per_month: "invoicesPerMonth" };
    const lk = keyMap[featureKey];
    if (lk) {
      const current = live ? (live.plan.limits[lk] ?? null) : 0;
      const higher = await db().select().from(plans).where(and(eq(plans.productId, product.id), eq(plans.onSale, true), gt(plans.rank, live?.plan.rank ?? -1))).orderBy(plans.rank);
      for (const pl of higher) {
        const v = pl.limits[lk];
        if (current !== null && (v === null || v === undefined || v > current)) {
          const p = await priceFor({ planId: pl.id }, "ANNUAL");
          if (p) {
            options.push({ kind: "PLAN", id: pl.id, code: pl.code, name: pl.name, priceCentavos: p.amountCentavos, cycle: "ANNUAL" });
            break;
          }
        }
      }
    }
  }
  options.sort((a, b) => a.priceCentavos - b.priceCentavos);
  return options[0] ?? null;
}

export async function featureInfo(key: string) {
  const [f] = await db().select().from(features).where(eq(features.key, key));
  if (f) return { key, name: f.name, benefit: f.benefit };
  const names: Record<string, string> = { users: "More users", branches: "More branches", companies: "More companies", invoices_per_month: "More invoices a month" };
  return { key, name: names[key] ?? key, benefit: "Raise the limit of your plan." };
}

/** Upgrade card data for an app or the upgrade page (FR-46). */
export async function upgradeCard(organizationId: string, appId: string, featureKey: string) {
  const info = await featureInfo(featureKey);
  const option = await cheapestUnlock(organizationId, appId, featureKey);
  return { feature: info, option, priceText: option ? `${formatPHP(option.priceCentavos)} ${option.cycle === "ANNUAL" ? "a year" : "a month"}` : null };
}

export function upgradeUrl(organizationId: string, featureKey: string, returnUrl: string, appId?: string) {
  const q = new URLSearchParams({ org: organizationId, feature: featureKey, return: returnUrl, ...(appId ? { app: appId } : {}) });
  return `${env().APP_URL.replace(/\/$/, "")}/upgrade?${q}`;
}

export async function recordPaywallEvent(organizationId: string, appId: string | null, featureKey: string, userId: string | null, action: "SHOWN" | "UPGRADE_CLICKED" | "REQUESTED" | "PURCHASED") {
  await db().insert(paywallEvents).values({ organizationId, appId, featureKey, userId, action });
}

/** FR-48: "Ask my Owner". Repeat requests for the same feature within 7 days are merged. */
export async function requestUpgrade(ctx: OrgContext, input: { featureKey: string; appId?: string | null; note?: string | null; returnUrl?: string | null }) {
  if (!ctx.actorId || !(await membershipOf(ctx, ctx.actorId))) throw new Error("not a member");
  const [open] = await db()
    .select()
    .from(upgradeRequests)
    .where(inOrg(ctx, upgradeRequests.organizationId, eq(upgradeRequests.featureKey, input.featureKey), eq(upgradeRequests.status, "OPEN"), gt(upgradeRequests.createdAt, new Date(Date.now() - 7 * 86_400_000))));
  if (open) return { request: open, merged: true };
  const [r] = await db()
    .insert(upgradeRequests)
    .values({ organizationId: ctx.organizationId, appId: input.appId ?? null, featureKey: input.featureKey, requesterId: ctx.actorId, note: input.note?.slice(0, 500) ?? null, returnUrl: input.returnUrl ?? null })
    .returning();
  await recordPaywallEvent(ctx.organizationId, input.appId ?? null, input.featureKey, ctx.actorId, "REQUESTED");
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "paywall.requested", entity: "upgrade_request", entityId: r!.id, after: input, ip: ctx.ip });
  await publish("paywall.request.created", ctx.organizationId, { requestId: r!.id, featureKey: input.featureKey, appId: input.appId ?? null, requesterId: ctx.actorId });
  const info = await featureInfo(input.featureKey);
  const [requester] = await db().select().from(users).where(eq(users.id, ctx.actorId));
  const [org] = await db().select().from(organizations).where(eq(organizations.id, ctx.organizationId));
  const deciders = await db()
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.status, "ACTIVE"), inArray(memberships.role, ["OWNER", "BILLING"])));
  for (const d of deciders)
    await sendMail({
      to: d.email,
      template: "upgrade-request",
      subject: `${requester!.name} asks for ${info.name}`,
      text: `Hello,\n\n${requester!.name} asked to turn on ${info.name} for ${org!.tradeName ?? org!.registeredName}.${input.note ? `\n\nTheir note: ${input.note}` : ""}\n\nApprove or decline: ${env().APP_URL}/org/requests\n\nSentire Cloud`,
    });
  return { request: r!, merged: false };
}

export async function decideRequest(ctx: OrgContext, requestId: string, approve: boolean, reason?: string) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  const [r] = await db().select().from(upgradeRequests).where(inOrg(ctx, upgradeRequests.organizationId, eq(upgradeRequests.id, requestId)));
  if (!r || r.status !== "OPEN") throw new Error("This request is no longer open.");
  if (!approve && !reason?.trim()) throw new Error("Give a short reason so the requester knows why.");
  await db().update(upgradeRequests).set({ status: approve ? "APPROVED" : "DECLINED", decidedBy: ctx.actorId, decidedAt: new Date(), reason: reason ?? null }).where(eq(upgradeRequests.id, r.id));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: approve ? "paywall.request_approved" : "paywall.request_declined", entity: "upgrade_request", entityId: r.id, after: { reason }, ip: ctx.ip });
  await publish("paywall.request.decided", ctx.organizationId, { requestId: r.id, featureKey: r.featureKey, approved: approve, reason: reason ?? null, requesterId: r.requesterId });
  const [requester] = await db().select().from(users).where(eq(users.id, r.requesterId));
  const info = await featureInfo(r.featureKey);
  await sendMail({
    to: requester!.email,
    template: "upgrade-decided",
    subject: approve ? `${info.name} is being turned on` : `Your request for ${info.name} was declined`,
    text: approve ? `Hello ${requester!.name},\n\nYour Owner approved ${info.name}. It opens as soon as the payment is done.\n\nSentire Cloud` : `Hello ${requester!.name},\n\nYour request for ${info.name} was declined.\n\nReason: ${reason}\n\nSentire Cloud`,
  });
  return r;
}

export async function openRequests(ctx: OrgContext) {
  return db()
    .select({ r: upgradeRequests, requester: { name: users.name, email: users.email } })
    .from(upgradeRequests)
    .innerJoin(users, eq(users.id, upgradeRequests.requesterId))
    .where(inOrg(ctx, upgradeRequests.organizationId, eq(upgradeRequests.status, "OPEN")))
    .orderBy(upgradeRequests.createdAt);
}

export async function paywallFigures() {
  const rows = await db().execute<{ feature_key: string; action: string; n: number }>(sql`select feature_key, action, count(*)::int as n from paywall_events group by 1, 2 order by 1, 2`);
  return Array.from(rows);
}

export { getEntitlement };
