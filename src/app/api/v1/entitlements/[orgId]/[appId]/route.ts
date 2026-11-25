import { authErrorResponse, verifyBearer } from "@/server/http/bearer";
import { getEntitlement, toPublic } from "@/server/entitlements/compute";

export const dynamic = "force-dynamic";

/** FR-25. The app's own machine token, or a user token for the same organization and app. */
export async function GET(req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) {
  const { orgId, appId } = await params;
  try {
    const t = await verifyBearer(req);
    const callerApp = t.client_id?.replace(/^sentire-/, "");
    const isMachine = !t.sub || t.sub === t.client_id;
    const ok = callerApp === appId && (isMachine ? (t.scope ?? "").includes("entitlements:read") : (t as { org_id?: string }).org_id === orgId);
    if (!ok) return Response.json({ error: "forbidden" }, { status: 403 });
    const e = await getEntitlement(orgId, appId);
    const body = e ? toPublic(e) : { organizationId: orgId, appId, state: "OFF", plan: null, addons: [], features: [], limits: {}, periodEnd: null, version: 0 };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    return authErrorResponse(e);
  }
}
