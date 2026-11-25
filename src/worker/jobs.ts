import { checkAllServices } from "@/server/hosting/status";

export interface JobDef<T = unknown> {
  name: string;
  cron?: string;
  handler: (data: T) => Promise<unknown>;
}

/** Every background job. Later phases add renewals, dunning, event delivery and provisioning. */
export const jobs: JobDef[] = [
  { name: "status.check", cron: "* * * * *", handler: () => checkAllServices() },
];
