import { handleWebhook } from "@/server/billing/payments";
import { hit } from "@/server/ratelimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Payment provider webhooks (FR-14, NFR-08). 200 after the event is stored; 400 when it is not genuine. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!(await hit(`webhook:${provider}`, 600, 60))) return new Response("slow down", { status: 429 });
  const raw = await req.text();
  try {
    const r = await handleWebhook(provider, req.headers, raw);
    return Response.json({ ok: true, duplicate: r.duplicate });
  } catch (e) {
    log.warn({ provider, err: (e as Error).message }, "webhook refused");
    return Response.json({ ok: false }, { status: 400 });
  }
}
