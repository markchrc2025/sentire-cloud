import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Server } from "node:http";
import { db } from "@/server/db/client";
import { auditEntries, emailTokens, events, invitations, memberships, outboundEmails, users } from "@/server/db/schema";
import { completeSecondFactor, signIn, signUp, verifyEmail, requestPasswordReset, resetPassword, FormError } from "@/server/account/service";
import { acceptInvitation, changeRole, createOrganization, inviteMember, listMembers, removeMember, transferOwnership, ForbiddenError } from "@/server/account/orgs";
import { orgContext } from "@/server/db/dal";
import { confirmTotp, startTotp } from "@/server/account/mfa";
import { createSession } from "@/server/account/sessions";
import { verifyBearer } from "@/server/http/bearer";
import { generate } from "otplib";
import { resetDb } from "../helpers";
import { authorize, Browser, decodeJwt, exchange, refresh, registerTestApp, startOidc } from "../oidc-harness";

const PROFILE = { registeredName: "Dela Cruz Trading Inc.", tin: "123-456-789", branchCode: "000", address: "1 Shoe Ave, Marikina City", vatStatus: "NON_VAT" as const, billingEmail: "billing@delacruz.ph" };

async function verifiedUser(name: string, email: string) {
  await signUp({ name, email, password: "a-long-safe-passphrase", acceptTerms: true, marketing: false });
  const [u] = await db().select().from(users).where(eq(users.email, email));
  await db().update(users).set({ emailVerified: true, status: "ACTIVE" }).where(eq(users.id, u!.id));
  return u!;
}

function linkToken(text: string) {
  return /token=([A-Za-z0-9_-]+)/.exec(text)![1]!;
}

let server: Server;
beforeAll(async () => {
  server = await startOidc();
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(resetDb);

describe("UC-01 sign up and create organization", () => {
  it("signs up, verifies by email link, creates the organization with the user as Owner", async () => {
    await signUp({ name: "Ana Dela Cruz", email: "Ana@DelaCruz.ph", password: "a-long-safe-passphrase", acceptTerms: true, marketing: true });
    const [mail] = await db().select().from(outboundEmails);
    expect(mail!.to).toBe("ana@delacruz.ph");
    const s = await verifyEmail(linkToken(mail!.text));
    expect(s).not.toBeNull();
    const [u] = await db().select().from(users);
    expect(u!.emailVerified).toBe(true);
    expect(u!.marketingConsentAt).not.toBeNull();
    const org = await createOrganization(u!.id, PROFILE, ["ledger"]);
    expect(org.tin).toBe("123456789");
    expect(org.branchCode).toBe("00000");
    const [m] = await db().select().from(memberships);
    expect(m!.role).toBe("OWNER");
    const types = (await db().select().from(events)).map((e) => e.type);
    expect(types).toContain("account.organization.created");
  });

  it("refuses short and breached passwords and missing consent", async () => {
    await expect(signUp({ name: "B", email: "b@x.ph", password: "short", acceptTerms: true, marketing: false })).rejects.toThrow(FormError);
    await expect(signUp({ name: "Bea", email: "b@x.ph", password: "password1234", acceptTerms: true, marketing: false })).rejects.toThrow(/breach/);
    await expect(signUp({ name: "Bea", email: "b@x.ph", password: "a-long-safe-passphrase", acceptTerms: false, marketing: false })).rejects.toThrow(/terms/);
  });

  it("does not reveal an existing email: sends a reset link instead", async () => {
    await verifiedUser("Ana", "ana@x.ph");
    const r = await signUp({ name: "Other", email: "ana@x.ph", password: "another-long-passphrase", acceptTerms: true, marketing: false });
    expect(r.userId).toBeNull();
    const mails = await db().select().from(outboundEmails);
    expect(mails.at(-1)!.template).toBe("reset");
  });

  it("flags a duplicate TIN and branch for staff review", async () => {
    const a = await verifiedUser("Alma", "a@x.ph");
    const b = await verifiedUser("Bert", "b@x.ph");
    await createOrganization(a.id, PROFILE, []);
    const dup = await createOrganization(b.id, PROFILE, []);
    expect(dup.flaggedDuplicateTin).toBe(true);
  });
});

describe("sign-in, lockout, two-factor and reset", () => {
  it("locks after 10 failures for 15 minutes", async () => {
    await verifiedUser("Ana", "ana@x.ph");
    for (let i = 0; i < 9; i++) expect((await signIn({ email: "ana@x.ph", password: "wrong-password-here" })).status).toBe("error");
    const r = await signIn({ email: "ana@x.ph", password: "wrong-password-here" });
    expect(r.status === "error" && r.message).toMatch(/locked/);
    expect((await signIn({ email: "ana@x.ph", password: "a-long-safe-passphrase" })).status).toBe("error");
  });

  it("needs the second factor after TOTP is on, and accepts a recovery code once", async () => {
    const u = await verifiedUser("Ana", "ana@x.ph");
    const { factorId, secret } = await startTotp(u.id, u.email);
    const r1 = await confirmTotp(u.id, factorId, await generate({ secret }));
    expect(r1.ok).toBe(true);
    const codes = (r1 as { recoveryCodes: string[] }).recoveryCodes;
    const s = await signIn({ email: "ana@x.ph", password: "a-long-safe-passphrase" });
    expect(s.status).toBe("mfa");
    const pending = await createSession(u.id, { pendingMfa: true });
    expect((await completeSecondFactor({ sessionId: pending.session.id, userId: u.id }, { code: "000000" })).status).toBe("error");
    expect((await completeSecondFactor({ sessionId: pending.session.id, userId: u.id }, { code: codes[0]! })).status).toBe("ok");
    const again = await createSession(u.id, { pendingMfa: true });
    expect((await completeSecondFactor({ sessionId: again.session.id, userId: u.id }, { code: codes[0]! })).status).toBe("error");
  });

  it("resets the password with an email link and signs out other sessions", async () => {
    const u = await verifiedUser("Ana", "ana@x.ph");
    await createSession(u.id);
    await requestPasswordReset("ana@x.ph");
    const mail = (await db().select().from(outboundEmails)).find((m) => m.template === "reset")!;
    await resetPassword(linkToken(mail.text), "a-brand-new-passphrase");
    expect((await signIn({ email: "ana@x.ph", password: "a-brand-new-passphrase" })).status).toBe("ok");
    await expect(resetPassword(linkToken(mail.text), "yet-another-passphrase")).rejects.toThrow(/expired/);
    const used = await db().select().from(emailTokens).where(eq(emailTokens.purpose, "RESET"));
    expect(used[0]!.usedAt).not.toBeNull();
  });
});

describe("UC-03 members and isolation", () => {
  it("invites, accepts, changes roles, keeps one Owner, transfers ownership, removes", async () => {
    const owner = await verifiedUser("Owner", "owner@x.ph");
    const org = await createOrganization(owner.id, PROFILE, ["ledger"]);
    const ctx = orgContext({ organizationId: org.id, actorId: owner.id });
    await inviteMember(ctx, { email: "acct@x.ph", role: "MEMBER", appIds: ["ledger"] });
    const mail = (await db().select().from(outboundEmails)).find((m) => m.template === "invite")!;
    const acct = await verifiedUser("Accountant", "acct@x.ph");
    await expect(acceptInvitation(linkToken(mail.text), { id: owner.id, email: owner.email })).rejects.toThrow(/sent to acct@x.ph/);
    await acceptInvitation(linkToken(mail.text), { id: acct.id, email: acct.email });
    const members = await listMembers(ctx);
    expect(members.map((m) => m.user.email).sort()).toEqual(["acct@x.ph", "owner@x.ph"]);
    const acctM = members.find((m) => m.user.id === acct.id)!.membership;
    const ownerM = members.find((m) => m.user.id === owner.id)!.membership;

    const memberCtx = orgContext({ organizationId: org.id, actorId: acct.id });
    await expect(inviteMember(memberCtx, { email: "z@x.ph", role: "MEMBER", appIds: [] })).rejects.toThrow(ForbiddenError);
    await expect(changeRole(ctx, ownerM.id, "ADMIN")).rejects.toThrow(/at least one Owner/);
    await transferOwnership(ctx, acctM.id);
    const after = await db().select().from(memberships).where(eq(memberships.organizationId, org.id));
    expect(after.find((m) => m.userId === acct.id)!.role).toBe("OWNER");
    expect(after.find((m) => m.userId === owner.id)!.role).toBe("ADMIN");
    const newOwnerCtx = orgContext({ organizationId: org.id, actorId: acct.id });
    await removeMember(newOwnerCtx, ownerM.id);
    expect((await listMembers(newOwnerCtx)).length).toBe(1);
    const audits = (await db().select().from(auditEntries).where(eq(auditEntries.organizationId, org.id))).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(["member.invited", "member.joined", "organization.ownership_transferred", "member.removed"]));
  });

  it("never shows one organization's members or invitations to another", async () => {
    const a = await verifiedUser("Alma", "a@x.ph");
    const b = await verifiedUser("Bert", "b@x.ph");
    const orgA = await createOrganization(a.id, PROFILE, []);
    const orgB = await createOrganization(b.id, { ...PROFILE, tin: "999-999-999" }, []);
    await inviteMember(orgContext({ organizationId: orgA.id, actorId: a.id }), { email: "c@x.ph", role: "MEMBER", appIds: [] });
    const ctxB = orgContext({ organizationId: orgB.id, actorId: b.id });
    expect((await listMembers(ctxB)).map((m) => m.user.id)).toEqual([b.id]);
    const invB = await db().select().from(invitations).where(eq(invitations.organizationId, orgB.id));
    expect(invB).toHaveLength(0);
    // B acting on A's membership id through B's context finds nothing.
    const [aMember] = await db().select().from(memberships).where(and(eq(memberships.organizationId, orgA.id), eq(memberships.userId, a.id)));
    await expect(removeMember(ctxB, aMember!.id)).rejects.toThrow(/not found/);
  });
});

describe("UC-02 single sign-on (OpenID Connect)", () => {
  it("signs a member into an app with organization claims, refuses non-members, and ends sessions on removal", async () => {
    const { clientId, secret } = await registerTestApp("test");
    const owner = await verifiedUser("Owner", "owner@x.ph");
    const org = await createOrganization(owner.id, PROFILE, ["test"]);
    const { token } = await createSession(owner.id);

    // Owners must have a second factor before opening apps (FR-02).
    const f0 = await authorize(new Browser(token), clientId);
    expect(f0.last).toBe("/account/security?required=1");
    const tf = await startTotp(owner.id, owner.email);
    await confirmTotp(owner.id, tf.factorId, await generate({ secret: tf.secret }));

    const flow = await authorize(new Browser(token), clientId);
    expect(flow.last).toMatch(/\/cb\?code=/);
    const code = new URL(flow.last).searchParams.get("code")!;
    const t = await exchange(code, flow.verifier, clientId, secret);
    expect(t.status).toBe(200);
    const id = decodeJwt(t.json.id_token!);
    expect(id).toMatchObject({ sub: owner.id, email: "owner@x.ph", org_id: org.id, org_role: "OWNER", app_access: true });
    const at = await verifyBearer(new Request("http://x", { headers: { authorization: `Bearer ${t.json.access_token}` } }));
    expect(at.sub).toBe(owner.id);
    expect((at as { org_id?: string }).org_id).toBe(org.id);

    // Not signed in to Sentire Cloud: sent to sign-in.
    const anon = await authorize(new Browser(), clientId);
    expect(anon.last).toMatch(/^\/sign-in\?next=/);

    // A member without app access is refused.
    const other = await verifiedUser("Other", "other@x.ph");
    await createOrganization(other.id, { ...PROFILE, tin: "111-222-333" }, []);
    const o = await createSession(other.id);
    const refused = await authorize(new Browser(o.token), clientId);
    expect(refused.last).toMatch(/^\/no-access\?app=test/);

    // A second member signs in; removing them revokes their refresh token.
    const ctx = orgContext({ organizationId: org.id, actorId: owner.id });
    await inviteMember(ctx, { email: "m@x.ph", role: "MEMBER", appIds: ["test"] });
    const mail = (await db().select().from(outboundEmails)).find((m) => m.template === "invite")!;
    const mem = await verifiedUser("Mem", "m@x.ph");
    await acceptInvitation(linkToken(mail.text), { id: mem.id, email: mem.email });
    const ms = await createSession(mem.id);
    const f2 = await authorize(new Browser(ms.token), clientId);
    const t2 = await exchange(new URL(f2.last).searchParams.get("code")!, f2.verifier, clientId, secret);
    expect(t2.json.refresh_token).toBeTruthy();
    expect((await refresh(t2.json.refresh_token!, clientId, secret)).status).toBe(200);
    const memM = (await listMembers(ctx)).find((x) => x.user.id === mem.id)!.membership;
    await removeMember(ctx, memM.id);
    const r = await refresh(t2.json.refresh_token!, clientId, secret);
    expect(r.status).toBe(400);
  });

  it("publishes discovery with PKCE and ES256", async () => {
    const res = await fetch("http://localhost:3999/.well-known/openid-configuration");
    const d = (await res.json()) as Record<string, unknown>;
    expect(d.issuer).toBe("http://localhost:3999");
    expect(d.code_challenge_methods_supported).toEqual(["S256"]);
    expect(d.id_token_signing_alg_values_supported).toContain("ES256");
    expect(d.backchannel_logout_supported).toBe(true);
  });
});

describe("signing keys", () => {
  it("rotates after 90 days and keeps the old key published until it is removed", async () => {
    const { rotateKeysIfDue, loadJwks } = await import("@/server/oidc/keys");
    const before = await loadJwks();
    expect(await rotateKeysIfDue(new Date())).toBe(false);
    expect(await rotateKeysIfDue(new Date(Date.now() + 91 * 86_400_000))).toBe(true);
    const after = await loadJwks();
    expect(after.keys.length).toBe(before.keys.length + 1);
    expect((after.keys[1] as { kid: string }).kid).toBe((before.keys[0] as { kid: string }).kid);
  });
});
