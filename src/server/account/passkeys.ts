import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env } from "@/lib/env";
import { db } from "../db/client";
import { mfaFactors, webauthnChallenges } from "../db/schema";
import { audit } from "../audit";
import { regenerateRecoveryCodes } from "./mfa";

function rp() {
  const u = new URL(env().APP_URL);
  return { rpID: u.hostname, origin: u.origin, rpName: "Sentire Cloud" };
}

async function saveChallenge(userId: string, purpose: "REGISTER" | "AUTHENTICATE", challenge: string) {
  await db().insert(webauthnChallenges).values({ userId, purpose, challenge, expiresAt: new Date(Date.now() + 5 * 60_000) });
}

async function takeChallenge(userId: string, purpose: "REGISTER" | "AUTHENTICATE") {
  const [c] = await db()
    .select()
    .from(webauthnChallenges)
    .where(and(eq(webauthnChallenges.userId, userId), eq(webauthnChallenges.purpose, purpose), gt(webauthnChallenges.expiresAt, new Date())))
    .orderBy(desc(webauthnChallenges.createdAt))
    .limit(1);
  if (c) await db().delete(webauthnChallenges).where(eq(webauthnChallenges.id, c.id));
  return c?.challenge;
}

async function passkeys(userId: string) {
  return db()
    .select()
    .from(mfaFactors)
    .where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "PASSKEY"), isNotNull(mfaFactors.confirmedAt)));
}

export async function passkeyRegistrationOptions(userId: string, email: string, name: string) {
  const { rpID, rpName } = rp();
  const existing = await passkeys(userId);
  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    userDisplayName: name,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId! })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await saveChallenge(userId, "REGISTER", opts.challenge);
  return opts;
}

export async function finishPasskeyRegistration(userId: string, response: RegistrationResponseJSON, label: string) {
  const expectedChallenge = await takeChallenge(userId, "REGISTER");
  if (!expectedChallenge) throw new Error("The passkey request expired. Try again.");
  const { rpID, origin } = rp();
  const v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID });
  if (!v.verified || !v.registrationInfo) throw new Error("The passkey could not be verified.");
  const cred = v.registrationInfo.credential;
  await db()
    .insert(mfaFactors)
    .values({
      userId,
      type: "PASSKEY",
      label: label || "Passkey",
      secret: Buffer.from(cred.publicKey).toString("base64url"),
      credentialId: cred.id,
      counter: cred.counter,
      transports: cred.transports ?? [],
      confirmedAt: new Date(),
    });
  await audit({ actorId: userId, action: "mfa.passkey.added", entity: "user", entityId: userId });
  const hasCodes = (await db().select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "RECOVERY_CODES")))).length > 0;
  return { recoveryCodes: hasCodes ? null : await regenerateRecoveryCodes(userId) };
}

export async function passkeyAuthenticationOptions(userId: string) {
  const { rpID } = rp();
  const keys = await passkeys(userId);
  if (!keys.length) return null;
  const opts = await generateAuthenticationOptions({
    rpID,
    allowCredentials: keys.map((k) => ({ id: k.credentialId!, transports: (k.transports ?? []) as never })),
    userVerification: "preferred",
  });
  await saveChallenge(userId, "AUTHENTICATE", opts.challenge);
  return opts;
}

export async function verifyPasskey(userId: string, response: AuthenticationResponseJSON): Promise<boolean> {
  const expectedChallenge = await takeChallenge(userId, "AUTHENTICATE");
  if (!expectedChallenge) return false;
  const key = (await passkeys(userId)).find((k) => k.credentialId === response.id);
  if (!key) return false;
  const { rpID, origin } = rp();
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: key.credentialId!, publicKey: Buffer.from(key.secret, "base64url"), counter: key.counter },
    });
    if (!v.verified) return false;
    await db().update(mfaFactors).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(mfaFactors.id, key.id));
    return true;
  } catch {
    return false;
  }
}
