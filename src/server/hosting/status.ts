import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { healthChecks, incidents } from "../db/schema";
import { audit } from "../audit";
import { monitoredServices, type MonitoredService } from "./services";

export interface ProbeResult {
  id: string;
  up: boolean;
  slow: boolean;
  status: number;
  ms: number;
  error?: string;
}

/** One health check. 2xx, 3xx, 401 and 403 mean the service answers. */
export async function probe(
  service: Pick<MonitoredService, "id" | "url" | "health">,
  { fetchImpl = fetch, timeoutMs = 20000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(service.url.replace(/\/$/, "") + (service.health || "/"), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "SentireCloudStatus/1" },
    });
    const up = res.status < 400 || res.status === 401 || res.status === 403;
    const ms = Date.now() - started;
    return { id: service.id, up, slow: up && ms > 5000, status: res.status, ms };
  } catch (e) {
    const name = (e as Error).name;
    return { id: service.id, up: false, slow: false, status: 0, ms: Date.now() - started, error: name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const OPEN_AFTER_FAILURES = 2;
const RESOLVE_AFTER_SUCCESSES = 3;

/** Record a probe and open or resolve incidents (activity 5.9). Returns the incident change, if any. */
export async function recordCheck(r: ProbeResult, serviceName: string): Promise<"opened" | "resolved" | null> {
  return db().transaction(async (tx) => {
    await tx.insert(healthChecks).values({ serviceId: r.id, up: r.up, slow: r.slow, httpStatus: r.status, ms: r.ms, error: r.error ?? null });
    const recent = await tx
      .select({ up: healthChecks.up })
      .from(healthChecks)
      .where(eq(healthChecks.serviceId, r.id))
      .orderBy(desc(healthChecks.at), desc(healthChecks.id))
      .limit(Math.max(OPEN_AFTER_FAILURES, RESOLVE_AFTER_SUCCESSES));
    const [open] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.serviceId, r.id), inArray(incidents.status, ["OPEN", "MONITORING"])))
      .limit(1);
    const lastN = (n: number, up: boolean) => recent.length >= n && recent.slice(0, n).every((c) => c.up === up);
    if (!open && lastN(OPEN_AFTER_FAILURES, false)) {
      const [inc] = await tx
        .insert(incidents)
        .values({ serviceId: r.id, title: `${serviceName} is not answering`, note: r.error ?? `HTTP ${r.status}` })
        .returning();
      await audit({ actorKind: "system", action: "incident.opened", entity: "incident", entityId: inc!.id, after: inc }, tx);
      return "opened";
    }
    if (open && lastN(RESOLVE_AFTER_SUCCESSES, true)) {
      await tx.update(incidents).set({ status: "RESOLVED", resolvedAt: new Date() }).where(eq(incidents.id, open.id));
      await audit({ actorKind: "system", action: "incident.resolved", entity: "incident", entityId: open.id }, tx);
      return "resolved";
    }
    return null;
  });
}

export async function checkAllServices(opts?: Parameters<typeof probe>[1]) {
  const services = monitoredServices();
  const results = await Promise.all(services.map((s) => probe(s, opts)));
  for (const [i, r] of results.entries()) await recordCheck(r, services[i]!.name);
  return results;
}

export interface ServiceStatus extends MonitoredService {
  up: boolean | null;
  slow: boolean;
  ms: number | null;
  lastCheckedAt: Date | null;
  uptime24h: number | null;
  uptime30d: number | null;
}

async function uptimeSince(since: Date) {
  const rows = await db()
    .select({
      serviceId: healthChecks.serviceId,
      total: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${healthChecks.up})::int`,
    })
    .from(healthChecks)
    .where(gte(healthChecks.at, since))
    .groupBy(healthChecks.serviceId);
  return new Map(rows.map((r) => [r.serviceId, r.total ? r.ok / r.total : null]));
}

export async function currentStatus(): Promise<{ services: ServiceStatus[]; incidents: (typeof incidents.$inferSelect)[] }> {
  const latest = await db().execute<{ service_id: string; up: boolean; slow: boolean; ms: number; at: Date }>(sql`
    select distinct on (service_id) service_id, up, slow, ms, at
    from health_checks order by service_id, at desc, id desc`);
  const byId = new Map(Array.from(latest).map((r) => [r.service_id, r]));
  const now = Date.now();
  const [d1, d30] = await Promise.all([uptimeSince(new Date(now - 86_400_000)), uptimeSince(new Date(now - 30 * 86_400_000))]);
  const services = monitoredServices().map((s) => {
    const l = byId.get(s.id);
    return {
      ...s,
      up: l ? l.up : null,
      slow: l?.slow ?? false,
      ms: l?.ms ?? null,
      lastCheckedAt: l ? new Date(l.at) : null,
      uptime24h: d1.get(s.id) ?? null,
      uptime30d: d30.get(s.id) ?? null,
    };
  });
  const recent = await db()
    .select()
    .from(incidents)
    .where(gte(incidents.startedAt, new Date(now - 30 * 86_400_000)))
    .orderBy(desc(incidents.startedAt))
    .limit(20);
  return { services, incidents: recent };
}
