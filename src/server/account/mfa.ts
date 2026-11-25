import { and, eq, isNotNull } from "drizzle-orm";
import { generateSecret, generateURI, verify } from "otplib";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { db } from "../db/client";
import { mfaFactors } from "../db/schema";
import { audit } from "../audit";

export async function confirmedFactors(userId: string) {
  return db()
    .select()
    .from(mfaFactors)
    .where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)));
}

export async function hasSecondFactor(userId: string) {
  const f = await confirmedFactors(userId);
  return f.some((x) => x.type === "TOTP" || x.type === "PASSKEY");
}

/** Start TOTP setup: unconfirmed factor plus the otpauth URI for the QR code. */
export async function startTotp(userId: string, email: string) {
  const secret = generateSecret();
  const [f] = await db()
    .insert(mfaFactors)
    .values({ userId, type: "TOTP", label: "Authenticator app", secret: encrypt(secret) })
    .returning();
  return { factorId: f!.id, secret, uri: generateURI({ issuer: "Sentire Cloud", label: email, secret }) };
}

async function checkTotp(secretBox: string, code: string, lastTimeStep: number | null): Promise<{ valid: boolean; timeStep?: number }> {
  if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) return { valid: false };
  const res = (await verify({
    secret: decrypt(secretBox),
    token: code.replace(/\s/g, ""),
    epochTolerance: 30,
    ...(lastTimeStep ? { afterTimeStep: lastTimeStep } : {}),
  }).catch(() => ({ valid: false }))) as { valid: boolean; timeStep?: number };
  return res;
}

/** Confirm TOTP setup with a first code; returns fresh recovery codes (shown once). */
export async function confirmTotp(userId: string, factorId: string, code: string) {
  const [f] = await db().select().from(mfaFactors).where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, userId)));
  if (!f || f.type !== "TOTP") throw new Error("Setup not found. Start again.");
  const r = await checkTotp(f.secret, code, null);
  if (!r.valid) return { ok: false as const };
  await db().update(mfaFactors).set({ confirmedAt: new Date(), lastTimeStep: r.timeStep ?? null }).where(eq(mfaFactors.id, f.id));
  const codes = await regenerateRecoveryCodes(userId);
  await audit({ actorId: userId, action: "mfa.totp.added", entity: "user", entityId: userId });
  return { ok: true as const, recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () => randomToken(6).replace(/[-_]/g, "x").slice(0, 8).toLowerCase());
  await db().delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, "RECOVERY_CODES")));
  await db()
    .insert(mfaFactors)
    .values({ userId, type: "RECOVERY_CODES", label: "Recovery codes", secret: JSON.stringify(codes.map(sha256)), confirmedAt: new Date() });
  return codes;
}

/** Verify a TOTP code or a recovery code (used once). */
export async function verifySecondFactor(userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const factors = await confirmedFactors(userId);
  const clean = code.trim().toLowerCase();
  for (const f of factors.filter((x) => x.type === "TOTP")) {
    const r = await checkTotp(f.secret, clean, f.lastTimeStep);
    if (r.valid) {
      await db().update(mfaFactors).set({ lastUsedAt: new Date(), lastTimeStep: r.timeStep ?? f.lastTimeStep }).where(eq(mfaFactors.id, f.id));
      return "totp";
    }
  }
  const rc = factors.find((x) => x.type === "RECOVERY_CODES");
  if (rc) {
    const hashes = JSON.parse(rc.secret) as string[];
    const h = sha256(clean.replace(/\s/g, ""));
    if (hashes.includes(h)) {
      await db()
        .update(mfaFactors)
        .set({ secret: JSON.stringify(hashes.filter((x) => x !== h)), lastUsedAt: new Date() })
        .where(eq(mfaFactors.id, rc.id));
      await audit({ actorId: userId, action: "mfa.recovery_code.used", entity: "user", entityId: userId });
      return "recovery";
    }
  }
  return null;
}

export async function removeFactor(userId: string, factorId: string) {
  await db().delete(mfaFactors).where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, userId)));
  await audit({ actorId: userId, action: "mfa.factor.removed", entity: "user", entityId: userId, after: { factorId } });
}
