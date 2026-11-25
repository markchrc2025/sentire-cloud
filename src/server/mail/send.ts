import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { db } from "../db/client";
import { outboundEmails } from "../db/schema";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template: string;
}

/** Records the email and sends it through Postal when configured (FR-42). Without Postal it is logged only. */
export async function sendMail(m: Mail): Promise<string> {
  const [row] = await db().insert(outboundEmails).values({ ...m, status: "QUEUED" }).returning({ id: outboundEmails.id });
  const id = row!.id;
  const e = env();
  if (!e.POSTAL_URL || !e.POSTAL_API_KEY) {
    await db().update(outboundEmails).set({ status: "LOGGED" }).where(eq(outboundEmails.id, id));
    log.info({ to: m.to, template: m.template }, "email logged (Postal not configured)");
    return id;
  }
  try {
    const res = await fetch(`${e.POSTAL_URL.replace(/\/$/, "")}/api/v1/send/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Server-API-Key": e.POSTAL_API_KEY },
      body: JSON.stringify({ to: [m.to], from: e.MAIL_FROM, subject: m.subject, plain_body: m.text, html_body: m.html }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; data?: { message_id?: string; message?: string } };
    if (!res.ok || body.status !== "success") throw new Error(body.data?.message ?? `HTTP ${res.status}`);
    await db().update(outboundEmails).set({ status: "SENT", sentAt: new Date(), providerRef: body.data?.message_id ?? null }).where(eq(outboundEmails.id, id));
  } catch (err) {
    await db().update(outboundEmails).set({ status: "FAILED", error: (err as Error).message }).where(eq(outboundEmails.id, id));
    log.error({ to: m.to, template: m.template, err: (err as Error).message }, "email failed");
  }
  return id;
}
