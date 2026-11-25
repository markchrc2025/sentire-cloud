"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { requireSession, clientIp } from "@/server/http/session";
import { orgContext } from "@/server/db/dal";
import { db } from "@/server/db/client";
import { products, subscriptionItems, subscriptions } from "@/server/db/schema";
import { requestUpgrade, upgradeCard } from "@/server/paywall/service";
import { changePlan, setAddOns } from "@/server/billing/subscriptions";
import { startCheckout } from "@/server/billing/payments";
import { BillingError } from "@/server/billing/statements";

function back(fd: FormData, extra: Record<string, string>) {
  const q = new URLSearchParams({ org: String(fd.get("org")), feature: String(fd.get("feature")), app: String(fd.get("app")), return: String(fd.get("return") ?? ""), ...extra });
  redirect(`/upgrade?${q}`);
}

export async function buyUpgradeAction(fd: FormData) {
  const s = await requireSession();
  const orgId = String(fd.get("org"));
  const feature = String(fd.get("feature"));
  const appId = String(fd.get("app"));
  const ret = String(fd.get("return") ?? "") || null;
  const ctx = orgContext({ organizationId: orgId, actorId: s.user.id, ip: await clientIp() });
  const card = await upgradeCard(orgId, appId, feature);
  if (!card.option) return back(fd, { error: "Not on sale yet." });
  const [product] = await db().select().from(products).where(eq(products.appId, appId));
  const [sub] = product
    ? await db().select().from(subscriptions).where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.productId, product.id), inArray(subscriptions.status, ["ACTIVE"])))
    : [];
  if (!sub) {
    if (card.option.kind === "PLAN") redirect(`/org/billing/subscribe?product=${product?.code ?? "ledger"}&plan=${card.option.code}`);
    return back(fd, { error: "Your organization needs an active subscription first." });
  }
  let url: string;
  try {
    let statementId: string | null = null;
    if (card.option.kind === "ADD_ON") {
      const current = (await db().select().from(subscriptionItems).where(and(eq(subscriptionItems.subscriptionId, sub.id), eq(subscriptionItems.kind, "ADD_ON"), eq(subscriptionItems.active, true)))).map((i) => i.addOnId!);
      statementId = (await setAddOns(ctx, sub.id, [...new Set([...current, card.option.id])])).statement?.id ?? null;
    } else {
      const r = await changePlan(ctx, sub.id, { planId: card.option.id });
      statementId = r.mode === "upgrade" ? r.statement!.id : null;
    }
    if (!statementId) return back(fd, { ok: "Done." });
    url = (await startCheckout(ctx, statementId, { returnUrl: ret, paywallFeature: feature })).url;
  } catch (e) {
    if (e instanceof BillingError) return back(fd, { error: e.message });
    throw e;
  }
  redirect(url);
}

export async function askOwnerAction(fd: FormData) {
  const s = await requireSession();
  const ctx = orgContext({ organizationId: String(fd.get("org")), actorId: s.user.id, ip: await clientIp() });
  const r = await requestUpgrade(ctx, { featureKey: String(fd.get("feature")), appId: String(fd.get("app")), note: String(fd.get("note") ?? "") || null, returnUrl: String(fd.get("return") ?? "") || null });
  back(fd, { ok: r.merged ? "You already asked this week. Your Owner has it." : "Sent. We will email you when your Owner decides." });
}
