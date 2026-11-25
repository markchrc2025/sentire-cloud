import { and, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { apps, instances, organizations, products, provisioningJobs, subscriptions, users, memberships } from "../db/schema";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { sendMail } from "../mail/send";
import { signBody } from "../hub/sign";
import { getEntitlement } from "../entitlements/compute";
import { putFile } from "../storage";

const RETRY_MINUTES = [1, 5, 30, 120, 720];

export async function instanceFor(organizationId: string, appId: string) {
  const [i] = await db().select().from(instances).where(and(eq(instances.organizationId, organizationId), eq(instances.appId, appId)));
  return i ?? null;
}

/** Where an app endpoint lives for an organization: the instance path for multi-site apps, else the app's own URL. */
export async function endpointFor(organizationId: string | null, appId: string, kind: "events" | "export" | "delete" | "suspend" | "resume" | "health" | "provision") {
  const [app] = await db().select().from(apps).where(eq(apps.appId, appId));
  if (!app) return null;
  const path = kind === "provision" ? undefined : app.instancePaths[kind];
  if (path && organizationId) {
    const inst = await instanceFor(organizationId, appId);
    if (inst?.baseUrl) return inst.baseUrl.replace(/\/$/, "") + path;
  }
  if (kind === "events") return app.eventEndpoint;
  if (kind === "provision") return app.provisionUrl;
  return null;
}

async function owner(organizationId: string) {
  const [o] = await db()
    .select({ email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "OWNER"), eq(memberships.status, "ACTIVE")));
  return o ?? null;
}

async function signedPost(appId: string, url: string, payload: object) {
  const [app] = await db().select().from(apps).where(eq(apps.appId, appId));
  if (!app?.eventSecretEnc) throw new Error("app has no event secret");
  const body = JSON.stringify(payload);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Sentire-Signature": signBody(decrypt(app.eventSecretEnc), body) }, body, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  // Frappe wraps whitelisted method results in {"message": ...}
  const data = (json.message && typeof json.message === "object" ? json.message : json) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, data, text: text.slice(0, 500) };
}

async function queue(instanceId: string, organizationId: string, kind: "PROVISION" | "EXPORT" | "DELETE" | "SUSPEND" | "RESUME", delayMs = 0) {
  const open = await db()
    .select()
    .from(provisioningJobs)
    .where(and(eq(provisioningJobs.instanceId, instanceId), eq(provisioningJobs.kind, kind), inArray(provisioningJobs.status, ["QUEUED", "RUNNING", "WAITING"])));
  if (open.length) return open[0]!;
  const [j] = await db().insert(provisioningJobs).values({ instanceId, organizationId, kind, nextAttemptAt: new Date(Date.now() + delayMs) }).returning();
  return j!;
}

/** UC-04 step 7: a paid subscription gets an instance (activity 5.3). */
export async function onActivated(organizationId: string, subscriptionId: string) {
  const [row] = await db().select({ appId: products.appId }).from(subscriptions).innerJoin(products, eq(products.id, subscriptions.productId)).where(eq(subscriptions.id, subscriptionId));
  if (!row) return;
  let inst = await instanceFor(organizationId, row.appId);
  if (!inst) inst = (await db().insert(instances).values({ organizationId, appId: row.appId }).returning())[0] ?? null;
  else if (inst.status === "EXPORTED" || inst.status === "EXPORTING") {
    // UC-12 1a: reactivated before deletion: data untouched.
    await db().update(instances).set({ status: "ACTIVE" }).where(eq(instances.id, inst.id));
    await db().update(provisioningJobs).set({ status: "DONE", log: "cancelled: subscription reactivated" }).where(and(eq(provisioningJobs.instanceId, inst.id), inArray(provisioningJobs.kind, ["EXPORT", "DELETE"]), inArray(provisioningJobs.status, ["QUEUED", "WAITING"])));
    return;
  }
  if (inst!.status === "ACTIVE") return;
  await queue(inst!.id, organizationId, "PROVISION");
}

/** UC-12: cancelled subscription: export now, delete after 30 days unless reactivated. */
export async function onCancelled(organizationId: string, subscriptionId: string) {
  const [row] = await db().select({ appId: products.appId }).from(subscriptions).innerJoin(products, eq(products.id, subscriptions.productId)).where(eq(subscriptions.id, subscriptionId));
  if (!row) return;
  const inst = await instanceFor(organizationId, row.appId);
  if (!inst || inst.status === "DELETED") return;
  await db().update(instances).set({ status: "EXPORTING" }).where(eq(instances.id, inst.id));
  await queue(inst.id, organizationId, "EXPORT");
}

/** Worker: run due jobs with retries (1 min, 5 min, 30 min, 2 h, 12 h), alerting staff after the third failure. */
export async function runProvisioningJobs(now = new Date()) {
  const due = await db()
    .select()
    .from(provisioningJobs)
    .where(and(inArray(provisioningJobs.status, ["QUEUED", "RUNNING"]), or(isNull(provisioningJobs.nextAttemptAt), lte(provisioningJobs.nextAttemptAt, now))))
    .limit(20);
  for (const j of due) await runJob(j.id).catch((e) => log.error({ err: e, job: j.id }, "provisioning job crashed"));
  // Deletion 30 days after the export is ready (UC-12 step 3).
  const exported = await db().select().from(instances).where(and(eq(instances.status, "EXPORTED"), lte(instances.exportExpiresAt, now)));
  for (const i of exported) {
    const sub = await liveSub(i.organizationId, i.appId);
    if (!sub) await queue(i.id, i.organizationId, "DELETE");
  }
}

async function liveSub(organizationId: string, appId: string) {
  const [s] = await db()
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(products, eq(products.id, subscriptions.productId))
    .where(and(eq(subscriptions.organizationId, organizationId), eq(products.appId, appId), inArray(subscriptions.status, ["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED"])));
  return s ?? null;
}

async function runJob(jobId: string) {
  const [j] = await db().update(provisioningJobs).set({ status: "RUNNING" }).where(eq(provisioningJobs.id, jobId)).returning();
  if (!j) return;
  const [inst] = await db().select().from(instances).where(eq(instances.id, j.instanceId));
  const attempt = j.attempt + 1;
  const note = (s: string) => `${j.log}${new Date().toISOString()} attempt ${attempt}: ${s}\n`;
  try {
    if (j.kind === "PROVISION") {
      const url = await endpointFor(inst!.organizationId, inst!.appId, "provision");
      if (!url) {
        await db().update(provisioningJobs).set({ status: "WAITING", attempt, log: note("no provisioning endpoint: waiting for staff to set up the site and mark it ready") }).where(eq(provisioningJobs.id, j.id));
        return;
      }
      const [org] = await db().select().from(organizations).where(eq(organizations.id, inst!.organizationId));
      const ent = await getEntitlement(inst!.organizationId, inst!.appId);
      const r = await signedPost(inst!.appId, url, { jobId: j.id, orgId: inst!.organizationId, organization: { registeredName: org!.registeredName, tradeName: org!.tradeName, tin: org!.tin, branchCode: org!.branchCode, vatStatus: org!.vatStatus }, plan: ent?.planCode, limits: ent?.limits, owner: await owner(inst!.organizationId) });
      if (!r.ok || typeof r.data.instanceUrl !== "string") throw new Error(`HTTP ${r.status} ${r.text}`);
      await markReady(inst!.id, r.data.instanceUrl as string, null);
      await db().update(provisioningJobs).set({ status: "DONE", attempt, log: note(`ready at ${r.data.instanceUrl}`), result: r.data as never }).where(eq(provisioningJobs.id, j.id));
    } else if (j.kind === "EXPORT") {
      const url = await endpointFor(inst!.organizationId, inst!.appId, "export");
      if (!url) {
        await db().update(provisioningJobs).set({ status: "WAITING", attempt, log: note("no export endpoint: staff export by hand and upload the file") }).where(eq(provisioningJobs.id, j.id));
        return;
      }
      const r = await signedPost(inst!.appId, url, { jobId: j.id, orgId: inst!.organizationId, callback: `${env().APP_URL}/api/v1/events` });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.text}`);
      if (typeof r.data.fileUrl === "string") await exportReady(j.id, r.data.fileUrl as string, (r.data.sha256 as string) ?? null);
      else await db().update(provisioningJobs).set({ status: "WAITING", attempt, log: note("export started; waiting for the app's export.ready event") }).where(eq(provisioningJobs.id, j.id));
    } else if (j.kind === "DELETE") {
      const url = await endpointFor(inst!.organizationId, inst!.appId, "delete");
      if (!url) {
        await db().update(provisioningJobs).set({ status: "WAITING", attempt, log: note("no delete endpoint: staff delete by hand and upload the certificate") }).where(eq(provisioningJobs.id, j.id));
        return;
      }
      const r = await signedPost(inst!.appId, url, { jobId: j.id, orgId: inst!.organizationId, confirm: "DELETE" });
      if (r.ok && r.data.manual) {
        await db().update(provisioningJobs).set({ status: "WAITING", attempt, log: note(`the app deletes by hand: ${String(r.data.note ?? "")}`) }).where(eq(provisioningJobs.id, j.id));
        await alertStaff(`Delete the ${inst!.appId} site of organization ${inst!.organizationId} and record the deletion certificate in the staff console.`);
        return;
      }
      if (!r.ok || typeof r.data.certificate !== "string") throw new Error(`HTTP ${r.status} ${r.text}`);
      await deleted(inst!.id, r.data.certificate as string, null);
      await db().update(provisioningJobs).set({ status: "DONE", attempt, log: note("deleted; certificate stored") }).where(eq(provisioningJobs.id, j.id));
    }
  } catch (e) {
    const wait = RETRY_MINUTES[attempt - 1];
    const failed = wait === undefined;
    await db()
      .update(provisioningJobs)
      .set({ status: failed ? "FAILED" : "QUEUED", attempt, log: note(`error: ${(e as Error).message}`), nextAttemptAt: failed ? null : new Date(Date.now() + wait * 60_000) })
      .where(eq(provisioningJobs.id, j.id));
    if (attempt === 3 || failed) await alertStaff(`${j.kind} for ${inst!.appId} (organization ${inst!.organizationId}) failed ${attempt} times: ${(e as Error).message}`);
    if (failed && j.kind === "PROVISION") await db().update(instances).set({ status: "FAILED" }).where(eq(instances.id, inst!.id));
  }
}

async function alertStaff(text: string) {
  const staff = await db().select({ email: users.email }).from(users).where(eq(users.platformRole, "PLATFORM_ADMIN"));
  for (const s of staff) await sendMail({ to: s.email, template: "staff-alert", subject: "Sentire Cloud: provisioning needs attention", text });
}

/** Instance ready: record its URL, email the Owner the link. Used by the provisioning call or by staff. */
export async function markReady(instanceId: string, baseUrl: string, staffId: string | null) {
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) throw new Error("Use the https address of the site.");
  const [i] = await db().update(instances).set({ status: "ACTIVE", baseUrl: baseUrl.replace(/\/$/, "") }).where(eq(instances.id, instanceId)).returning();
  await db().update(provisioningJobs).set({ status: "DONE" }).where(and(eq(provisioningJobs.instanceId, instanceId), eq(provisioningJobs.kind, "PROVISION"), inArray(provisioningJobs.status, ["QUEUED", "WAITING", "RUNNING"])));
  await audit({ organizationId: i!.organizationId, actorId: staffId, actorKind: staffId ? "staff" : "system", action: "instance.ready", entity: "instance", entityId: i!.id, after: { baseUrl } });
  await publish("account.instance.ready", i!.organizationId, { appId: i!.appId, baseUrl: i!.baseUrl });
  const o = await owner(i!.organizationId);
  const [app] = await db().select().from(apps).where(eq(apps.appId, i!.appId));
  if (o) await sendMail({ to: o.email, template: "instance-ready", subject: `${app!.name} is ready`, text: `Hello ${o.name},\n\n${app!.name} is ready for your organization:\n${i!.baseUrl}\n\nSign in with your Sentire Account.\n\nSentire Cloud` });
  return i!;
}

/** The app (or staff) reports the export file. The Owner gets the link for 30 days. */
export async function exportReady(jobId: string, fileUrl: string, sha256: string | null) {
  const [j] = await db().select().from(provisioningJobs).where(eq(provisioningJobs.id, jobId));
  if (!j || j.kind !== "EXPORT") throw new Error("export job not found");
  const expires = new Date(Date.now() + 30 * 86_400_000);
  const [i] = await db().update(instances).set({ status: "EXPORTED", exportFileUrl: fileUrl, exportSha256: sha256, exportReadyAt: new Date(), exportExpiresAt: expires }).where(eq(instances.id, j.instanceId)).returning();
  await db().update(provisioningJobs).set({ status: "DONE", log: `${j.log}export ready\n`, result: { fileUrl, sha256 } }).where(eq(provisioningJobs.id, j.id));
  await audit({ organizationId: i!.organizationId, actorKind: "system", action: "instance.exported", entity: "instance", entityId: i!.id, after: { sha256 } });
  const o = await owner(i!.organizationId);
  if (o) await sendMail({ to: o.email, template: "export-ready", subject: "Your data export is ready", text: `Hello ${o.name},\n\nYour full data export is ready. Download it from the billing page of Sentire Cloud before ${expires.toISOString().slice(0, 10)}:\n${env().APP_URL}/org/billing\n\nAfter that date the data is deleted and you receive a deletion certificate.\n\nSentire Cloud` });
}

export async function deleted(instanceId: string, certificateText: string, staffId: string | null) {
  const [i0] = await db().select().from(instances).where(eq(instances.id, instanceId));
  const f = await putFile({ organizationId: i0!.organizationId, purpose: "deletion-certificate", name: `deletion-certificate-${i0!.appId}.txt`, contentType: "text/plain", body: Buffer.from(certificateText), createdBy: staffId });
  await db().update(instances).set({ status: "DELETED", deletedAt: new Date(), deletionCertificateKey: f.storageKey }).where(eq(instances.id, instanceId));
  await audit({ organizationId: i0!.organizationId, actorId: staffId, actorKind: staffId ? "staff" : "system", action: "instance.deleted", entity: "instance", entityId: instanceId });
}

export async function orgInstances(organizationId: string) {
  return db().select().from(instances).where(eq(instances.organizationId, organizationId));
}

