import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "../db/client";
import { apps, deliveries, entitlements, events } from "../db/schema";
import { decrypt } from "@/lib/crypto";
import { log } from "@/lib/log";
import { onPublish, type SentireEvent } from "./publish";
import { signBody } from "./sign";
import { endpointFor } from "../hosting/instances";

/** Retry schedule (FR-29): 1 min, 5 min, 30 min, 2 h, 12 h, then FAILED. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];

/** Apps that hear an organization's account and billing events: those with an entitlement for it and an event endpoint. */
async function recipients(e: SentireEvent, tx = db()) {
  if (!e.company) return [];
  const rows = await tx
    .select({ app: apps })
    .from(entitlements)
    .innerJoin(apps, eq(apps.appId, entitlements.appId))
    .where(eq(entitlements.organizationId, e.company));
  return rows.map((r) => r.app).filter((a) => a.active && (a.eventEndpoint || a.instancePaths.events) && a.eventSecretEnc && (a.acceptsEvents.length === 0 || a.acceptsEvents.some((p) => (p.endsWith("*") ? e.type.startsWith(p.slice(0, -1)) : p === e.type))));
}

onPublish(async (e, tx) => {
  if (!e.type.startsWith("account.") && !e.type.startsWith("billing.") && !e.type.startsWith("paywall.")) return;
  const to = await recipients(e, tx as never);
  if (to.length) await tx.insert(deliveries).values(to.map((a) => ({ eventId: e.id, appId: a.appId, organizationId: e.company, nextAttemptAt: new Date() }))).onConflictDoNothing();
}, "deliver");

export async function deliverOne(deliveryId: string, fetchImpl: typeof fetch = fetch) {
  const [d] = await db().select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!d || d.status === "DELIVERED" || d.status === "FAILED") return d?.status;
  const [ev] = await db().select().from(events).where(eq(events.eventId, d.eventId));
  const [app] = await db().select().from(apps).where(eq(apps.appId, d.appId));
  const endpoint = await endpointFor(d.organizationId, d.appId, "events");
  if (!ev || !endpoint || !app?.eventSecretEnc) {
    await db().update(deliveries).set({ status: "NOT_DELIVERED", error: "app has no event endpoint" }).where(eq(deliveries.id, d.id));
    return "NOT_DELIVERED";
  }
  const body = JSON.stringify(ev.data);
  const attempt = d.attempt + 1;
  let status = 0;
  let error: string | null = null;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentire-Signature": signBody(decrypt(app.eventSecretEnc), body), "X-Sentire-Event": ev.type, "X-Sentire-Event-Id": ev.eventId },
      body,
      signal: AbortSignal.timeout(10000),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message;
  }
  if (!error) {
    await db().update(deliveries).set({ status: "DELIVERED", attempt, httpStatus: status, deliveredAt: new Date(), error: null }).where(eq(deliveries.id, d.id));
    return "DELIVERED";
  }
  const wait = RETRY_MINUTES[attempt - 1];
  if (wait === undefined) {
    await db().update(deliveries).set({ status: "FAILED", attempt, httpStatus: status || null, error }).where(eq(deliveries.id, d.id));
    log.error({ delivery: d.id, app: d.appId, type: ev.type, error }, "event delivery failed for good");
    return "FAILED";
  }
  await db().update(deliveries).set({ status: "RETRYING", attempt, httpStatus: status || null, error, nextAttemptAt: new Date(Date.now() + wait * 60_000) }).where(eq(deliveries.id, d.id));
  return "RETRYING";
}

/** Called every 10 seconds by the worker. */
export async function sweepDeliveries(fetchImpl?: typeof fetch) {
  const due = await db()
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(inArray(deliveries.status, ["PENDING", "RETRYING"]), or(lte(deliveries.nextAttemptAt, new Date()))))
    .limit(50);
  for (const d of due) await deliverOne(d.id, fetchImpl);
  return due.length;
}

export async function resend(deliveryId: string) {
  await db().update(deliveries).set({ status: "PENDING", attempt: 0, nextAttemptAt: new Date(), error: null }).where(eq(deliveries.id, deliveryId));
}
