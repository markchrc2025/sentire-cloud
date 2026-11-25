import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { randomToken, sha256 } from "@/lib/crypto";
import { db } from "../db/client";
import { emailTokens, sessions, users } from "../db/schema";
import { audit } from "../audit";
import { limit } from "../ratelimit";
import { sendMail } from "../mail/send";
import { templates } from "../mail/templates";
import { checkNewPassword, hashPassword, verifyPassword } from "./passwords";
import { createSession, revokeAllSessions } from "./sessions";
import { hasSecondFactor, verifySecondFactor } from "./mfa";
import { verifyPasskey } from "./passkeys";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export class FormError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export async function findUserByEmail(email: string) {
  const [u] = await db().select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return u ?? null;
}

async function issueEmailToken(userId: string, purpose: "VERIFY" | "RESET", hours: number) {
  const token = randomToken();
  await db().insert(emailTokens).values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) });
  return token;
}

/** UC-01 steps 2 to 3. */
export async function signUp(input: { name: string; email: string; password: string; acceptTerms: boolean; marketing: boolean; ip?: string | null }) {
  const name = input.name.trim();
  if (name.length < 2) throw new FormError("Enter your full name.", "name");
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) throw new FormError("Enter a valid email address.", "email");
  const email = parsed.data;
  if (!input.acceptTerms) throw new FormError("Accept the terms and privacy notice to continue.", "acceptTerms");
  await limit(`signup:${input.ip ?? "?"}`, 10, 3600);
  const existing = await findUserByEmail(email);
  if (existing) {
    // Do not reveal more than the reset flow already shows: send a reset link instead.
    if (existing.emailVerified) {
      const token = await issueEmailToken(existing.id, "RESET", 1);
      await sendMail({ to: existing.email, ...templates.reset(existing.name, token) });
    } else {
      const token = await issueEmailToken(existing.id, "VERIFY", 24);
      await sendMail({ to: existing.email, ...templates.verify(existing.name, token) });
    }
    return { userId: null };
  }
  const problem = await checkNewPassword(input.password, email);
  if (problem) throw new FormError(problem.message, problem.field);
  const now = new Date();
  const [u] = await db()
    .insert(users)
    .values({
      email,
      name,
      passwordHash: await hashPassword(input.password),
      termsAcceptedAt: now,
      marketingConsentAt: input.marketing ? now : null,
    })
    .returning();
  await audit({ actorId: u!.id, action: "user.signed_up", entity: "user", entityId: u!.id, ip: input.ip, after: { email, marketing: input.marketing } });
  const token = await issueEmailToken(u!.id, "VERIFY", 24);
  await sendMail({ to: email, ...templates.verify(name, token) });
  return { userId: u!.id };
}

async function consumeToken(token: string, purpose: "VERIFY" | "RESET") {
  const [t] = await db()
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())))
    .limit(1);
  if (!t) return null;
  await db().update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, t.id));
  return t;
}

/** UC-01 step 4: verify and sign in. */
export async function verifyEmail(token: string, ip?: string | null) {
  const t = await consumeToken(token, "VERIFY");
  if (!t) return null;
  await db().update(users).set({ emailVerified: true, status: "ACTIVE" }).where(eq(users.id, t.userId));
  await audit({ actorId: t.userId, action: "user.email_verified", entity: "user", entityId: t.userId, ip });
  return createSession(t.userId, { ip });
}

export async function resendVerification(email: string, ip?: string | null) {
  await limit(`resend:${email.toLowerCase()}`, 5, 3600);
  const u = await findUserByEmail(email);
  if (!u || u.emailVerified) return;
  const token = await issueEmailToken(u.id, "VERIFY", 24);
  await sendMail({ to: u.email, ...templates.verify(u.name, token) });
  await audit({ actorId: u.id, action: "user.verification_resent", entity: "user", entityId: u.id, ip });
}

const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

export type SignInResult =
  | { status: "ok"; token: string }
  | { status: "mfa"; token: string }
  | { status: "unverified"; email: string }
  | { status: "error"; message: string };

/** UC-02 step 3 (password). Returns a full session, or a short pending session that needs the second factor. */
export async function signIn(input: { email: string; password: string; ip?: string | null; device?: string | null }): Promise<SignInResult> {
  const generic = { status: "error" as const, message: "Email or password is not correct." };
  const email = input.email.trim().toLowerCase();
  await limit(`signin:ip:${input.ip ?? "?"}`, 30, 600);
  await limit(`signin:email:${email}`, 20, 600);
  const u = await findUserByEmail(email);
  if (!u || !u.passwordHash) {
    await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$ZHVtbXk", input.password); // equal timing
    return generic;
  }
  if (u.status === "DISABLED") return generic;
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    return { status: "error", message: "Too many failed attempts. Your account is locked for 15 minutes." };
  }
  const ok = await verifyPassword(u.passwordHash, input.password);
  if (!ok) {
    const failures = u.failedSignIns + 1;
    const lock = failures >= LOCK_AFTER;
    await db()
      .update(users)
      .set({ failedSignIns: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil })
      .where(eq(users.id, u.id));
    await audit({ actorId: u.id, action: lock ? "user.locked" : "user.sign_in_failed", entity: "user", entityId: u.id, ip: input.ip });
    if (lock) {
      await sendMail({ to: u.email, ...templates.locked(u.name) });
      return { status: "error", message: "Too many failed attempts. Your account is locked for 15 minutes." };
    }
    return generic;
  }
  if (!u.emailVerified) return { status: "unverified", email: u.email };
  await db().update(users).set({ failedSignIns: 0, lockedUntil: null }).where(eq(users.id, u.id));
  if (await hasSecondFactor(u.id)) {
    const { token } = await createSession(u.id, { pendingMfa: true, ip: input.ip, device: input.device });
    return { status: "mfa", token };
  }
  return finishSignIn(u.id, u.name, u.email, input.ip, input.device);
}

async function finishSignIn(userId: string, name: string, email: string, ip?: string | null, device?: string | null): Promise<SignInResult> {
  const { token } = await createSession(userId, { ip, device });
  await db().update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, userId));
  await audit({ actorId: userId, action: "user.signed_in", entity: "user", entityId: userId, ip, after: { device } });
  if (device) await sendMail({ to: email, ...templates.newSignIn(name, device, ip ?? "unknown address") });
  return { status: "ok", token };
}

/** Second step: TOTP, recovery code or passkey. Consumes the pending session. */
export async function completeSecondFactor(
  pending: { sessionId: string; userId: string },
  proof: { code?: string; passkey?: AuthenticationResponseJSON },
  ip?: string | null,
  device?: string | null,
): Promise<SignInResult> {
  await limit(`mfa:${pending.userId}`, 10, 600);
  let ok = false;
  if (proof.passkey) ok = await verifyPasskey(pending.userId, proof.passkey);
  else if (proof.code) ok = (await verifySecondFactor(pending.userId, proof.code)) !== null;
  if (!ok) {
    await audit({ actorId: pending.userId, action: "user.mfa_failed", entity: "user", entityId: pending.userId, ip });
    return { status: "error", message: "That code is not correct." };
  }
  await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, pending.sessionId));
  const [u] = await db().select().from(users).where(eq(users.id, pending.userId));
  return finishSignIn(u!.id, u!.name, u!.email, ip, device);
}

export async function requestPasswordReset(email: string, ip?: string | null) {
  await limit(`reset:${ip ?? "?"}`, 10, 3600);
  await limit(`reset:email:${email.toLowerCase()}`, 3, 3600);
  const u = await findUserByEmail(email);
  if (!u || u.status === "DISABLED") return;
  const token = await issueEmailToken(u.id, "RESET", 1);
  await sendMail({ to: u.email, ...templates.reset(u.name, token) });
  await audit({ actorId: u.id, action: "user.reset_requested", entity: "user", entityId: u.id, ip });
}

export async function resetPassword(token: string, password: string, ip?: string | null) {
  const [t] = await db()
    .select()
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, "RESET"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())));
  if (!t) throw new FormError("This link has expired. Ask for a new one.");
  const [u] = await db().select().from(users).where(eq(users.id, t.userId));
  const problem = await checkNewPassword(password, u!.email);
  if (problem) throw new FormError(problem.message, "password");
  await consumeToken(token, "RESET");
  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(password), failedSignIns: 0, lockedUntil: null, emailVerified: true, status: "ACTIVE" })
    .where(eq(users.id, t.userId));
  await revokeAllSessions(t.userId);
  await audit({ actorId: t.userId, action: "user.password_reset", entity: "user", entityId: t.userId, ip });
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId: string) {
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, current))) throw new FormError("Your current password is not correct.", "current");
  const problem = await checkNewPassword(next, u.email);
  if (problem) throw new FormError(problem.message, "password");
  await db().update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await revokeAllSessions(userId, keepSessionId);
  await audit({ actorId: userId, action: "user.password_changed", entity: "user", entityId: userId });
}

export async function requestAccountDeletion(userId: string) {
  await db().update(users).set({ deletionRequestedAt: new Date() }).where(eq(users.id, userId));
  await audit({ actorId: userId, action: "user.deletion_requested", entity: "user", entityId: userId });
}

export async function setMarketingConsent(userId: string, consent: boolean) {
  await db().update(users).set({ marketingConsentAt: consent ? new Date() : null }).where(eq(users.id, userId));
  await audit({ actorId: userId, action: consent ? "user.marketing_consent_given" : "user.marketing_consent_withdrawn", entity: "user", entityId: userId });
}
