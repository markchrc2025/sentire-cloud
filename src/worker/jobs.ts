import { checkAllServices } from "@/server/hosting/status";
import { rotateKeysIfDue } from "@/server/oidc/keys";
import { purgeExpiredOidcPayloads } from "@/server/oidc/adapter";
import { billingDaily } from "@/server/billing/daily";

export interface JobDef<T = unknown> {
  name: string;
  cron?: string;
  handler: (data: T) => Promise<unknown>;
}

/** Every background job. Later phases add renewals, dunning, event delivery and provisioning. */
export const jobs: JobDef[] = [
  { name: "status.check", cron: "* * * * *", handler: () => checkAllServices() },
  { name: "oidc.rotate-keys", cron: "17 3 * * *", handler: () => rotateKeysIfDue() },
  { name: "oidc.purge", cron: "29 3 * * *", handler: () => purgeExpiredOidcPayloads() },
  // Hourly so a past-due or suspended state is never more than an hour late; every step is idempotent.
  { name: "billing.daily", cron: "7 * * * *", handler: () => billingDaily() },
];
