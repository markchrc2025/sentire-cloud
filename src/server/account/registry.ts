import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { apps } from "../db/schema";

/** The Sentire apps. Inserted on boot if missing; staff edit URLs and contracts in the admin console. */
export const DEFAULT_APPS = [
  { appId: "ledger", name: "Sentire Ledger", engine: "PYTHON_FRAMEWORK", baseUrl: "https://ledger.sentire.solutions" },
  { appId: "payroll", name: "Sentire Payroll", engine: "TYPESCRIPT_KIT", baseUrl: "https://payroll.sentire.solutions" },
  { appId: "projects", name: "Sentire Projects", engine: "TYPESCRIPT_KIT", baseUrl: "https://projects.apps.sentire.solutions" },
  { appId: "helpdesk", name: "Sentire Helpdesk", engine: "PYTHON_FRAMEWORK", baseUrl: "https://helpdesk.apps.sentire.solutions" },
  { appId: "lms", name: "Sentire LMS", engine: "PYTHON_FRAMEWORK", baseUrl: "https://lms.apps.sentire.solutions" },
  { appId: "pms", name: "Sentire PMS", engine: "TYPESCRIPT_KIT", baseUrl: "https://pms.apps.sentire.solutions" },
] as const;

/** Ledger is multi-site: each organization has its own site, so these paths are relative to the site (Phase 4). */
export const LEDGER_PATHS = {
  events: "/api/method/ph_cas.cloud.events.receive",
  callback: "/api/method/ph_cas.cloud.sso.callback",
  export: "/api/method/ph_cas.cloud.provisioning.export",
  delete: "/api/method/ph_cas.cloud.provisioning.delete_site_data",
  health: "/api/method/ping",
};

export async function ensureRegistry() {
  for (const a of DEFAULT_APPS) {
    await db()
      .insert(apps)
      .values({ ...a, oidcClientId: `sentire-${a.appId}`, instancePaths: a.appId === "ledger" ? LEDGER_PATHS : {} })
      .onConflictDoNothing();
  }
  await db().update(apps).set({ instancePaths: LEDGER_PATHS }).where(and(eq(apps.appId, "ledger"), sql`${apps.instancePaths} = '{}'::jsonb`));
}

export async function listApps() {
  return db().select().from(apps).orderBy(apps.name);
}
