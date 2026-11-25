import { desc, eq, inArray } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "../db/client";
import { signingKeys } from "../db/schema";
import { audit } from "../audit";

export const ROTATE_AFTER_DAYS = 90;
/** Retired keys stay published past the longest token lifetime (refresh 12 h, sessions 7 days) before removal. */
export const REMOVE_RETIRED_AFTER_DAYS = 8;

async function newKey() {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = randomUUID();
  const priv = { ...(await exportJWK(privateKey)), kid, alg: "ES256", use: "sig" };
  const pub = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  await db().insert(signingKeys).values({ kid, publicJwk: pub, privateJwkEnc: encrypt(JSON.stringify(priv)) });
  await audit({ actorKind: "system", action: "oidc.key.created", entity: "signing_key", entityId: kid });
  return kid;
}

/** Active key first (it signs), then retired keys (published for verification). */
export async function loadJwks(): Promise<{ keys: Record<string, unknown>[]; version: string }> {
  let rows = await db().select().from(signingKeys).where(inArray(signingKeys.status, ["ACTIVE", "RETIRED"])).orderBy(desc(signingKeys.createdAt));
  if (!rows.some((r) => r.status === "ACTIVE")) {
    await newKey();
    rows = await db().select().from(signingKeys).where(inArray(signingKeys.status, ["ACTIVE", "RETIRED"])).orderBy(desc(signingKeys.createdAt));
  }
  const sorted = [...rows.filter((r) => r.status === "ACTIVE"), ...rows.filter((r) => r.status === "RETIRED")];
  return { keys: sorted.map((r) => JSON.parse(decrypt(r.privateJwkEnc))), version: sorted.map((r) => r.kid).join(",") };
}

/** Daily job: rotate after 90 days, remove retired keys after 8 days. */
export async function rotateKeysIfDue(now = new Date()) {
  const rows = await db().select().from(signingKeys).where(inArray(signingKeys.status, ["ACTIVE", "RETIRED"]));
  const active = rows.find((r) => r.status === "ACTIVE");
  let rotated = false;
  if (!active || now.getTime() - active.createdAt.getTime() > ROTATE_AFTER_DAYS * 86_400_000) {
    await newKey();
    if (active) await db().update(signingKeys).set({ status: "RETIRED", retiredAt: now }).where(eq(signingKeys.id, active.id));
    rotated = true;
  }
  for (const r of rows.filter((x) => x.status === "RETIRED")) {
    if (r.retiredAt && now.getTime() - r.retiredAt.getTime() > REMOVE_RETIRED_AFTER_DAYS * 86_400_000) {
      await db().update(signingKeys).set({ status: "REMOVED" }).where(eq(signingKeys.id, r.id));
    }
  }
  return rotated;
}
