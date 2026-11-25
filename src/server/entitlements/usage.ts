import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { entitlements, usageRecords } from "../db/schema";
import { z } from "zod";

export const usageInput = z.object({
  organizationId: z.string().min(1),
  appId: z.string().min(1),
  meter: z.string().regex(/^[a-z0-9_.]+$/),
  quantity: z.number().int().min(0),
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().min(1).max(200),
});

/** POST /api/v1/usage. Idempotent per app and key. */
export async function reportUsage(input: z.infer<typeof usageInput>) {
  const r = await db().insert(usageRecords).values(input).onConflictDoNothing().returning();
  return { stored: r.length > 0 };
}

/** Latest count per meter for an organization and app (counts are snapshots, so the newest wins). */
export async function latestUsage(organizationId: string, appId: string) {
  const rows = await db().execute<{ meter: string; quantity: string }>(sql`
    select distinct on (meter) meter, quantity from usage_records
    where organization_id = ${organizationId} and app_id = ${appId}
    order by meter, period_date desc, created_at desc`);
  return Object.fromEntries(Array.from(rows).map((r) => [r.meter, Number(r.quantity)]));
}

/** Usage against the plan for the billing page (FR-26), with an 80% warning. */
export async function usageLines(organizationId: string) {
  const ents = await db().select().from(entitlements).where(eq(entitlements.organizationId, organizationId)).orderBy(desc(entitlements.computedAt));
  const out: Record<string, string> = {};
  for (const e of ents) {
    if (!e.subscriptionId) continue;
    const used = await latestUsage(organizationId, e.appId);
    const parts: string[] = [];
    for (const [k, lim] of Object.entries(e.limits)) {
      const u = used[k];
      if (u === undefined) continue;
      const label = k.replace(/_/g, " ");
      parts.push(lim.value === null ? `${label}: ${u}` : `${label}: ${u} of ${lim.value}${u >= 0.8 * lim.value ? " (near the limit)" : ""}`);
    }
    if (parts.length) out[e.subscriptionId] = `Usage: ${parts.join(" · ")}`;
  }
  return out;
}

