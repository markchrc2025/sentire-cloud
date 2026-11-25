import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { subscriptionItems, subscriptions } from "../db/schema";

/** Add-ons per subscription, and usage text filled by entitlements (Phase 3). */
export type UsageText = (organizationId: string) => Promise<Record<string, string>>;
let usageText: UsageText = async () => ({});
export function setUsageText(fn: UsageText) {
  usageText = fn;
}

export async function billingPageExtras(organizationId: string) {
  const items = await db()
    .select({ subscriptionId: subscriptionItems.subscriptionId, addOnId: subscriptionItems.addOnId })
    .from(subscriptionItems)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionItems.subscriptionId))
    .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptionItems.kind, "ADD_ON"), eq(subscriptionItems.active, true)));
  const addOns: Record<string, string[]> = {};
  for (const i of items) (addOns[i.subscriptionId] ??= []).push(i.addOnId!);
  return { addOns, usage: await usageText(organizationId) };
}
