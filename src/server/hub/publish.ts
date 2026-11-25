import { randomUUID } from "node:crypto";
import { db, type DBorTx } from "../db/client";
import { events } from "../db/schema";

/** sentire.event.v1 envelope (same as sentire-kit buildEvent). */
export interface SentireEvent<T = unknown> {
  specVersion: "sentire.event.v1";
  eventId: string;
  type: string;
  source: string;
  organizationId: string | null;
  occurredAt: string;
  data: T;
}

export function buildEvent<T>(type: string, organizationId: string | null, data: T, source = "sentire-cloud"): SentireEvent<T> {
  return { specVersion: "sentire.event.v1", eventId: randomUUID(), type, source, organizationId, occurredAt: new Date().toISOString(), data };
}

type Hook = (e: SentireEvent, tx: DBorTx) => Promise<void>;
const hooks: Hook[] = [];
/** Delivery (Phase 3) registers here. */
export function onPublish(h: Hook) {
  hooks.push(h);
}

/** Record an account or billing event in the same transaction as the change; delivery is queued after commit. */
export async function publish<T>(type: string, organizationId: string | null, data: T, tx: DBorTx = db()) {
  const e = buildEvent(type, organizationId, data);
  await tx.insert(events).values({ eventId: e.eventId, type, source: e.source, organizationId, data: e as never, direction: "OUT" });
  for (const h of hooks) await h(e as SentireEvent, tx);
  return e;
}
