import { InboundError, receiveEvent } from "@/server/hub/inbound";

export const dynamic = "force-dynamic";

/** Apps send sentire.event.v1 events here, signed with their event secret. */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await receiveEvent(req.headers.get("x-sentire-signature"), raw);
    return Response.json({ ok: true, ...r }, { status: 202 });
  } catch (e) {
    if (e instanceof InboundError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
