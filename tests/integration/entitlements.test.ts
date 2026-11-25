import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apps, checkoutSessions, deliveries, entitlements, events, outboundEmails, plans, prices, addOns, subscriptions, upgradeRequests, users, billingStatements } from "@/server/db/schema";
import { wire } from "@/server/wire";
import { seedCatalog } from "@/server/billing/catalog";
import { subscribe } from "@/server/billing/subscriptions";
import { handleWebhook, startCheckout } from "@/server/billing/payments";
import { testSignature } from "@/server/billing/providers/test";
import { closePeriods, issueRenewals, runDunning } from "@/server/billing/daily";
import { createOrganization, inviteMember } from "@/server/account/orgs";
import { signUp } from "@/server/account/service";
import { orgContext, type OrgContext } from "@/server/db/dal";
import { getEntitlement } from "@/server/entitlements/compute";
import { cheapestUnlock, decideRequest, requestUpgrade } from "@/server/paywall/service";
import { deliverOne, sweepDeliveries } from "@/server/hub/deliver";
import { receiveEvent } from "@/server/hub/inbound";
import { signBody, verifySignature } from "@/server/hub/sign";
import { encrypt } from "@/lib/crypto";
import { addDays, manilaDate } from "@/lib/time";
import { resetDb } from "../helpers";
import { BASE, startOidc } from "../oidc-harness";

wire();
let server: Server;
beforeAll(async () => {
  server = await startOidc();
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(resetDb);

async function setup() {
  await seedCatalog();
  const { ensureRegistry } = await import("@/server/account/registry");
  await ensureRegistry();
  await signUp({ name: "Owner One", email: "owner@x.ph", password: "a-long-safe-passphrase", acceptTerms: true, marketing: false });
  const [u] = await db().select().from(users);
  await db().update(users).set({ emailVerified: true });
  const org = await createOrganization(u!.id, { registeredName: "Dela Cruz Trading Inc.", tin: "123456789", address: "Marikina City", vatStatus: "NON_VAT", billingEmail: "billing@delacruz.ph" }, ["ledger"]);
  const ctx = orgContext({ organizationId: org.id, actorId: u!.id });
  const plan = async (code: string) => (await db().select().from(plans).where(eq(plans.code, code)))[0]!.id;
  return { ctx, orgId: org.id, userId: u!.id, plan };
}

async function pay(statementId: string, ctx: OrgContext) {
  await startCheckout(ctx, statementId);
  const [cs] = await db().select().from(checkoutSessions).where(and(eq(checkoutSessions.statementId, statementId), eq(checkoutSessions.status, "PENDING")));
  const body = JSON.stringify({ id: `evt_${cs!.id}`, type: "paid", ref: cs!.providerRef, amount: cs!.amountCentavos });
  await handleWebhook("test", new Headers({ "x-test-signature": testSignature(body) }), body);
}

async function ledgerSecretSetup() {
  const eventSecret = "ledger-event-secret-ledger-event-secret";
  const clientSecret = "ledger-client-secret-ledger-client-secret";
  await db().update(apps).set({ eventEndpoint: "https://ledger.example/sentire/events", eventSecretEnc: encrypt(eventSecret), oidcClientSecretEnc: encrypt(clientSecret), redirectUris: ["https://ledger.example/cb"] }).where(eq(apps.appId, "ledger"));
  return { eventSecret, clientSecret };
}

describe("entitlements follow the subscription (FR-24, 6.2)", () => {
  it("OFF, ACTIVE with plan limits, READ_ONLY when suspended, ACTIVE again on payment", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("team"), cycle: "ANNUAL", method: "ONLINE" });
    expect(await getEntitlement(orgId, "ledger")).toBeNull();
    await pay(statement.id, ctx);
    let e = await getEntitlement(orgId, "ledger");
    expect(e).toMatchObject({ state: "ACTIVE", planCode: "team", version: 1 });
    expect(e!.limits.users).toEqual({ value: 5, mode: "HARD" });
    expect(e!.limits.invoices_per_month).toEqual({ value: 1000, mode: "HARD" });
    // Run to suspension
    const end = addDays(manilaDate(), 1);
    await db().update(subscriptions).set({ currentPeriodStart: addDays(end, -365), currentPeriodEnd: end });
    await issueRenewals();
    const at = (d: number) => new Date(Date.now() + (1 + d) * 86_400_000 + 3600_000);
    await closePeriods(at(0));
    expect((await getEntitlement(orgId, "ledger"))!.state).toBe("ACTIVE"); // past due keeps access
    await runDunning(at(8));
    e = await getEntitlement(orgId, "ledger");
    expect(e!.state).toBe("READ_ONLY");
    const [r] = await db().select().from(billingStatements).where(eq(billingStatements.kind, "RENEWAL"));
    await pay(r!.id, ctx);
    expect((await getEntitlement(orgId, "ledger"))!.state).toBe("ACTIVE");
    const types = (await db().select().from(events)).filter((x) => x.type === "account.entitlement.changed");
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it("enforces the plan's user seats when inviting (UC-03 2a)", async () => {
    const { ctx, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    await expect(inviteMember(ctx, { email: "m@x.ph", role: "MEMBER", appIds: ["ledger"] })).rejects.toThrow(/no free seat for: ledger/);
    await inviteMember(ctx, { email: "m@x.ph", role: "MEMBER", appIds: [] });
  });
});

describe("APIs for apps", () => {
  it("reads entitlements and reports usage with the app's client_credentials token", async () => {
    const { ctx, orgId, plan } = await setup();
    const { clientSecret } = await ledgerSecretSetup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    const tok = await fetch(`${BASE}/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`sentire-ledger:${clientSecret}`).toString("base64") },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "entitlements:read usage:write" }),
    });
    expect(tok.status).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const { GET } = await import("@/app/api/v1/entitlements/[orgId]/[appId]/route");
    const res = await GET(new Request("http://x", { headers: { authorization: `Bearer ${access_token}` } }), { params: Promise.resolve({ orgId, appId: "ledger" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "ACTIVE", plan: "solo", version: 1 });
    const other = await GET(new Request("http://x", { headers: { authorization: `Bearer ${access_token}` } }), { params: Promise.resolve({ orgId, appId: "payroll" }) });
    expect(other.status).toBe(403);
    const { POST } = await import("@/app/api/v1/usage/route");
    const body = { organizationId: orgId, appId: "ledger", meter: "users", quantity: 1, periodDate: manilaDate(), idempotencyKey: "u1" };
    const u = await POST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(u.status).toBe(200);
    const noAuth = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
    expect(noAuth.status).toBe(401);
  });
});

describe("event delivery (FR-29 core)", () => {
  it("signs account events for the app, retries on failure, and fails after the schedule", async () => {
    const { ctx, orgId, plan } = await setup();
    const { eventSecret } = await ledgerSecretSetup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    const ds = await db().select().from(deliveries).where(eq(deliveries.organizationId, orgId));
    expect(ds.length).toBeGreaterThan(0);
    const seen: { sig: string; body: string }[] = [];
    const ok = (async (_url: string, init: RequestInit) => {
      seen.push({ sig: (init.headers as Record<string, string>)["X-Sentire-Signature"]!, body: String(init.body) });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sweepDeliveries(ok)).toBe(ds.length);
    expect(verifySignature([eventSecret], seen[0]!.sig, seen[0]!.body)).toBe(true);
    expect(JSON.parse(seen[0]!.body).specVersion).toBe("sentire.event.v1");
    // A failing endpoint: five retries, then FAILED
    const [d] = await db().insert(deliveries).values({ eventId: ds[0]!.eventId, appId: "payroll", organizationId: orgId }).returning();
    await db().update(apps).set({ eventEndpoint: "https://payroll.example/e", eventSecretEnc: encrypt("x".repeat(32)) }).where(eq(apps.appId, "payroll"));
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await deliverOne(d!.id, bad));
    expect(results).toEqual(["RETRYING", "RETRYING", "RETRYING", "RETRYING", "RETRYING", "FAILED"]);
  });

  it("accepts a signed ledger.invoice.issued and writes the invoice number (CR-01)", async () => {
    const { ctx, plan } = await setup();
    const { eventSecret } = await ledgerSecretSetup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    const body = JSON.stringify({ specVersion: "sentire.event.v1", eventId: "e-1", type: "ledger.invoice.issued", source: "ledger", organizationId: null, data: { statementId: statement.id, invoiceNumber: "SI-000123" } });
    await expect(receiveEvent("t=1,v1=bad", body)).rejects.toThrow(/signature/);
    expect((await receiveEvent(signBody(eventSecret, body), body)).duplicate).toBe(false);
    expect((await receiveEvent(signBody(eventSecret, body), body)).duplicate).toBe(true);
    const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, statement.id));
    expect(st!.birInvoiceNumber).toBe("SI-000123");
  });
});

describe("paywall (FR-44 to FR-49)", () => {
  it("finds the cheapest unlock: the AI add-on when on sale, the next plan for more users", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    expect(await cheapestUnlock(orgId, "ledger", "ai.assistant")).toBeNull(); // add-on not on sale yet
    const [ai] = await db().select().from(addOns).where(eq(addOns.code, "ai-assistant"));
    await db().update(addOns).set({ onSale: true }).where(eq(addOns.id, ai!.id));
    await db().insert(prices).values({ addOnId: ai!.id, cycle: "ANNUAL", amountCentavos: 600000, validFrom: "2026-11-01" });
    expect(await cheapestUnlock(orgId, "ledger", "ai.assistant")).toMatchObject({ kind: "ADD_ON", code: "ai-assistant", priceCentavos: 600000 });
    expect(await cheapestUnlock(orgId, "ledger", "users")).toMatchObject({ kind: "PLAN", code: "team" });
  });

  it("Ask my Owner: merges repeats, notifies, and the decision reaches the requester", async () => {
    const { ctx, orgId, userId } = await setup();
    const mctx = orgContext({ organizationId: orgId, actorId: userId });
    const r1 = await requestUpgrade(mctx, { featureKey: "ai.assistant", appId: "ledger", note: "For receipts" });
    const r2 = await requestUpgrade(mctx, { featureKey: "ai.assistant", appId: "ledger" });
    expect(r2.merged).toBe(true);
    expect(await db().select().from(upgradeRequests)).toHaveLength(1);
    await expect(decideRequest(ctx, r1.request.id, false)).rejects.toThrow(/reason/);
    await decideRequest(ctx, r1.request.id, false, "Not this quarter");
    const mails = (await db().select().from(outboundEmails)).map((m) => m.template);
    expect(mails).toEqual(expect.arrayContaining(["upgrade-request", "upgrade-decided"]));
  });
});

describe("staff overrides", () => {
  it("an override adds a feature and is reflected in the entitlement", async () => {
    const { ctx, orgId, plan } = await setup();
    const { statement } = await subscribe(ctx, { planId: await plan("solo"), cycle: "ANNUAL", method: "ONLINE" });
    await pay(statement.id, ctx);
    const { addOverride } = await import("@/server/admin/actions-core");
    await addOverride("staff-1", { organizationId: orgId, appId: "ledger", features: ["ai.assistant"], forceState: null, reason: "Pilot", expiresAt: null });
    const e = await getEntitlement(orgId, "ledger");
    expect(e!.features.map((f) => f.key)).toContain("ai.assistant");
    expect(e!.version).toBe(2);
  });
});

export { entitlements };
