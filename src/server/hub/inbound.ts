import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { apps, events } from "../db/schema";
import { decrypt } from "@/lib/crypto";
import { verifySignature } from "./sign";
import { recordInvoiceNumber } from "../billing/payments";
import { exportReady } from "../hosting/instances";

/** Events apps send to Sentire Cloud (POST /api/v1/events). App-to-app routing arrives in Phase 5. */
const handlers: Record<string, (data: unknown, appId: string) => Promise<void>> = {
  /** CR-01: Sentire's own Ledger company issued the BIR invoice for a paid statement. */
  "ledger.invoice.issued": async (data, appId) => {
    const d = z.object({ statementId: z.string(), invoiceNumber: z.string().min(1) }).parse(data);
    if (appId !== "ledger") throw new Error("only Ledger issues Sentire's invoices");
    await recordInvoiceNumber(null, d.statementId, d.invoiceNumber);
  },
  /** UC-12 step 2: the app finished the export. */
  "app.export.ready": async (data) => {
    const d = z.object({ jobId: z.string(), fileUrl: z.string().url(), sha256: z.string().optional() }).parse(data);
    await exportReady(d.jobId, d.fileUrl, d.sha256 ?? null);
  },
};

export class InboundError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function receiveEvent(signature: string | null, rawBody: string) {
  let env: { id?: string; type?: string; source?: string; company?: string | null; data?: unknown };
  try {
    env = JSON.parse(rawBody);
  } catch {
    throw new InboundError(400, "invalid JSON");
  }
  // Source is "ledger" or "sentire-ledger" (the app id, optionally with the client prefix).
  const appId = String(env.source ?? "").replace(/^sentire-/, "");
  const [app] = await db().select().from(apps).where(eq(apps.appId, appId));
  if (!app?.eventSecretEnc) throw new InboundError(401, "unknown source");
  const secrets = [decrypt(app.eventSecretEnc), ...(app.previousEventSecretEnc ? [decrypt(app.previousEventSecretEnc)] : [])];
  if (!verifySignature(secrets, signature, rawBody)) throw new InboundError(401, "bad signature");
  if (!env.id || !env.type) throw new InboundError(400, "id and type are required");
  const ins = await db().insert(events).values({ eventId: `${appId}:${env.id}`, type: env.type, source: appId, organizationId: env.company ?? null, data: env as never, direction: "IN" }).onConflictDoNothing().returning();
  if (!ins.length) return { duplicate: true };
  const h = handlers[env.type];
  if (h) await h(env.data, appId);
  return { duplicate: false };
}
