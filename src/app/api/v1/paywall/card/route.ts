import { authErrorResponse, verifyBearer } from "@/server/http/bearer";
import { recordPaywallEvent, upgradeCard, upgradeUrl } from "@/server/paywall/service";
import { db } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** FR-46: what the shared upgrade card shows, for the signed-in user (Upgrade or Ask my Owner). */
export async function GET(req: Request) {
  try {
    const t = await verifyBearer(req);
    const org = (t as { org_id?: string }).org_id;
    const appId = t.client_id?.replace(/^sentire-/, "");
    const u = new URL(req.url);
    const feature = u.searchParams.get("feature");
    if (!t.sub || !org || !appId || !feature) return Response.json({ error: "feature and a user token with org are required" }, { status: 400 });
    const [m] = await db().select().from(memberships).where(and(eq(memberships.organizationId, org), eq(memberships.userId, t.sub), eq(memberships.status, "ACTIVE")));
    const card = await upgradeCard(org, appId, feature);
    await recordPaywallEvent(org, appId, feature, t.sub, "SHOWN");
    const canBuy = m?.role === "OWNER" || m?.role === "BILLING";
    return Response.json({ ...card, action: canBuy ? "UPGRADE" : "ASK_OWNER", upgradeUrl: upgradeUrl(org, feature, u.searchParams.get("return") ?? "", appId) });
  } catch (e) {
    return authErrorResponse(e);
  }
}
