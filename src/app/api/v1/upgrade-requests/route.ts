import { z } from "zod";
import { authErrorResponse, verifyBearer } from "@/server/http/bearer";
import { orgContext } from "@/server/db/dal";
import { requestUpgrade } from "@/server/paywall/service";

export const dynamic = "force-dynamic";

const body = z.object({ featureKey: z.string().min(1), note: z.string().max(500).optional(), returnUrl: z.string().url().optional() });

/** FR-48: "Ask my Owner" from inside an app, with the user's access token. */
export async function POST(req: Request) {
  try {
    const t = await verifyBearer(req);
    const org = (t as { org_id?: string }).org_id;
    if (!t.sub || !org) return Response.json({ error: "user token with org required" }, { status: 403 });
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return Response.json({ error: "invalid body" }, { status: 400 });
    const r = await requestUpgrade(orgContext({ organizationId: org, actorId: t.sub }), { ...p.data, appId: t.client_id?.replace(/^sentire-/, "") ?? null });
    return Response.json({ requestId: r.request.id, merged: r.merged }, { status: r.merged ? 200 : 201 });
  } catch (e) {
    return authErrorResponse(e);
  }
}
