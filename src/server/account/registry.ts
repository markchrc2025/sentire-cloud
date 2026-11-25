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

export async function ensureRegistry() {
  for (const a of DEFAULT_APPS) {
    await db()
      .insert(apps)
      .values({ ...a, oidcClientId: `sentire-${a.appId}` })
      .onConflictDoNothing();
  }
}

export async function listApps() {
  return db().select().from(apps).orderBy(apps.name);
}
