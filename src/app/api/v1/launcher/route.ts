import { eq } from "drizzle-orm";
import { authErrorResponse, verifyBearer } from "@/server/http/bearer";
import { db } from "@/server/db/client";
import { oidcGrantOrgs } from "@/server/db/schema";
import { allowedApps } from "@/server/account/orgs";
import { listApps } from "@/server/account/registry";
import { launcherExtras } from "@/server/account/launcher";

export const dynamic = "force-dynamic";

/** FR-05: app switcher data for sentire-kit. Bearer = the user's access token from any Sentire app. */
export async function GET(req: Request) {
  try {
    const t = await verifyBearer(req);
    if (!t.sub || t.sub === t.client_id) return Response.json({ error: "user token required" }, { status: 403 });
    const orgId = new URL(req.url).searchParams.get("org") ?? (t as { org_id?: string }).org_id;
    let organizationId = orgId;
    if (!organizationId && t.jti) {
      const grantId = (t as { grantId?: string }).grantId;
      if (grantId) organizationId = (await db().select().from(oidcGrantOrgs).where(eq(oidcGrantOrgs.grantId, grantId)))[0]?.organizationId;
    }
    if (!organizationId) return Response.json({ error: "org required" }, { status: 400 });
    const allowed = await allowedApps(t.sub, organizationId);
    const extras = await launcherExtras(organizationId);
    const apps = (await listApps())
      .filter((a) => a.active && allowed.includes(a.appId))
      .map((a) => ({ appId: a.appId, name: a.name, url: extras[a.appId]?.url ?? a.baseUrl, state: extras[a.appId]?.label ?? null }));
    return Response.json({ organizationId, apps, accountUrl: `${process.env.APP_URL ?? ""}/account` });
  } catch (e) {
    return authErrorResponse(e);
  }
}
