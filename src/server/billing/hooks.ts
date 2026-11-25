import { shared } from "../shared";
import type { DBorTx } from "../db/client";

/** Phase 3 (entitlements) and Phase 4 (provisioning) register here. */
export const billingHooks = shared("billingHooks", () => ({
  onSubscriptionChanged: [] as ((organizationId: string, subscriptionId: string, tx: DBorTx) => Promise<void>)[],
  onActivated: [] as ((organizationId: string, subscriptionId: string) => Promise<void>)[],
  onCancelled: [] as ((organizationId: string, subscriptionId: string) => Promise<void>)[],
}));

export async function subscriptionChanged(organizationId: string, subscriptionId: string, tx: DBorTx) {
  for (const h of billingHooks.onSubscriptionChanged) await h(organizationId, subscriptionId, tx);
}
