import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apps, checkoutSessions, deliveries, instances, outboundEmails, plans, provisioningJobs, users, subscriptions } from "@/server/db/schema";
import { wire } from "@/server/wire";
import { ensureRegistry } from "@/server/account/registry";
import { seedCatalog } from "@/server/billing/catalog";
import { setCancelAtPeriodEnd, subscribe } from "@/server/billing/subscriptions";
import { handleWebhook, startCheckout } from "@/server/billing/payments";
import { testSignature } from "@/server/billing/providers/test";
import { closePeriods } from "@/server/billing/daily";
import { createOrganization } from "@/server/account/orgs";
import { signUp } from "@/server/account/service";
import { orgContext } from "@/server/db/dal";
import { markReady, runProvisioningJobs } from "@/server/hosting/instances";
import { sweepDeliveries } from "@/server/hub/deliver";
import { verifySignature } from "@/server/hub/sign";
import { encrypt } from "@/lib/crypto";
import { addDays, manilaDate } from "@/lib/time";
import { resetDb } from "../helpers";

wire();
const SECRET = "ledger-event-secret-ledger-event-secret";
const calls: { path: string; body: Record<string, unknown>; ok: boolean }[] = [];
let site: Server;
beforeAll(async () => {
  site = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ok = verifySignature([SECRET], String(req.headers["x-sentire-signature"] ?? ""), raw);
      calls.push({ path: req.url!, body: JSON.parse(raw || "{}"), ok });
      res.setHeader("Content-Type", "application/json");
      if (req.url!.includes("provisioning.export")) return res.end(JSON.stringify({ message: { fileUrl: "https://files.example/export.zip", sha256: "abc" } }));
      if (req.url!.includes("delete_site_data")) return res.end(JSON.stringify({ message: { certificate: "DELETION CERTIFICATE ..." } }));
      res.end(JSON.stringify({ message: { ok: true } }));
    });
  });
  await new Promise<void>((r) => site.listen(4011, r));
});
afterAll(() => new Promise<void>((r) => site.close(() => r())));
beforeEach(async () => {
  calls.length = 0;
  await resetDb();
});

async function paidLedger() {
  await seedCatalog();
  await ensureRegistry();
  await db().update(apps).set({ eventSecretEnc: encrypt(SECRET) }).where(eq(apps.appId, "ledger"));
  await signUp({ name: "Owner One", email: "owner@x.ph", password: "a-long-safe-passphrase", acceptTerms: true, marketing: false });
  const [u] = await db().select().from(users);
  const org = await createOrganization(u!.id, { registeredName: "Dela Cruz Trading Inc.", tin: "123456789", address: "Marikina City", vatStatus: "NON_VAT", billingEmail: "billing@delacruz.ph" }, ["ledger"]);
  const ctx = orgContext({ organizationId: org.id, actorId: u!.id });
  const [solo] = await db().select().from(plans).where(eq(plans.code, "solo"));
  const { statement } = await subscribe(ctx, { planId: solo!.id, cycle: "ANNUAL", method: "ONLINE" });
  await startCheckout(ctx, statement.id);
  const [cs] = await db().select().from(checkoutSessions);
  const body = JSON.stringify({ id: "e1", type: "paid", ref: cs!.providerRef, amount: cs!.amountCentavos });
  await handleWebhook("test", new Headers({ "x-test-signature": testSignature(body) }), body);
  return { ctx, orgId: org.id };
}

describe("UC-04 step 7 and UC-12: instance lifecycle for Ledger", () => {
  it("waits for staff to set up the site, then emails the Owner and delivers events to the site", async () => {
    const { orgId } = await paidLedger();
    const [inst] = await db().select().from(instances);
    expect(inst!.status).toBe("PROVISIONING");
    await runProvisioningJobs();
    const [job] = await db().select().from(provisioningJobs);
    expect(job!.status).toBe("WAITING");
    await markReady(inst!.id, "http://localhost:4011", "staff-1");
    expect((await db().select().from(outboundEmails)).some((m) => m.template === "instance-ready")).toBe(true);
    // events go to the organization's own site, signed
    await db().update(deliveries).set({ status: "PENDING" });
    await sweepDeliveries();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.path === "/api/method/ph_cas.cloud.events.receive" && c.ok)).toBe(true);
    expect(calls.some((c) => (c.body as { type: string }).type === "account.entitlement.changed")).toBe(true);
    expect(orgId).toBeTruthy();
  });

  it("on cancellation exports through the site, then deletes after 30 days and stores the certificate", async () => {
    const { ctx, orgId } = await paidLedger();
    const [inst] = await db().select().from(instances);
    await markReady(inst!.id, "http://localhost:4011", null);
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
    await setCancelAtPeriodEnd(ctx, sub!.id, true);
    await db().update(subscriptions).set({ currentPeriodEnd: manilaDate() });
    await closePeriods(new Date(Date.now() + 3600_000));
    await runProvisioningJobs();
    let [i] = await db().select().from(instances);
    expect(i!.status).toBe("EXPORTED");
    expect(i!.exportFileUrl).toBe("https://files.example/export.zip");
    expect((await db().select().from(outboundEmails)).some((m) => m.template === "export-ready")).toBe(true);
    await runProvisioningJobs(new Date(Date.now() + 31 * 86_400_000));
    await runProvisioningJobs(new Date(Date.now() + 31 * 86_400_000));
    [i] = await db().select().from(instances);
    expect(i!.status).toBe("DELETED");
    expect(i!.deletionCertificateKey).toBeTruthy();
    expect(calls.find((c) => c.path.includes("delete_site_data"))!.body).toMatchObject({ orgId, confirm: "DELETE" });
  });

  it("allows the instance callback as a redirect for the Ledger client", async () => {
    await paidLedger();
    const [inst] = await db().select().from(instances);
    await markReady(inst!.id, "https://delacruz.ledger.sentire.solutions", null);
    await db().update(apps).set({ oidcClientSecretEnc: encrypt("s".repeat(32)) }).where(eq(apps.appId, "ledger"));
    const { PgAdapter } = await import("@/server/oidc/adapter");
    const c = (await new PgAdapter("Client").find("sentire-ledger")) as { redirect_uris: string[] };
    expect(c.redirect_uris).toContain("https://delacruz.ledger.sentire.solutions/api/method/ph_cas.cloud.sso.callback");
  });
});

export { addDays, and };
