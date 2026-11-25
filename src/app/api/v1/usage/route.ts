import { authErrorResponse } from "@/server/http/bearer";
import { requireAppToken } from "@/server/http/app-auth";
import { reportUsage, usageInput } from "@/server/entitlements/usage";

export const dynamic = "force-dynamic";

/** FR-26 and FR-21: apps report counts and metered usage with their machine token. */
export async function POST(req: Request) {
  try {
    const { appId } = await requireAppToken(req, "usage:write");
    const body = await req.json().catch(() => null);
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const raw of items) {
      const p = usageInput.safeParse(raw);
      if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "invalid" }, { status: 400 });
      if (p.data.appId !== appId) return Response.json({ error: "appId does not match the token" }, { status: 403 });
      out.push(await reportUsage(p.data));
    }
    return Response.json({ ok: true, results: out });
  } catch (e) {
    return authErrorResponse(e);
  }
}
