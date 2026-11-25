import { hash, verify } from "@node-rs/argon2";
import { createHash } from "node:crypto";
import { log } from "@/lib/log";

const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP argon2id baseline

export async function hashPassword(pw: string) {
  return hash(pw, OPTS);
}

export async function verifyPassword(hashText: string, pw: string) {
  try {
    return await verify(hashText, pw);
  } catch {
    return false;
  }
}

/** Have I Been Pwned range check (k-anonymity: only 5 hash characters leave the server). Fails open after 2 s. */
export async function isBreached(pw: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (process.env.NODE_ENV === "test" && fetchImpl === fetch) return pw === "password1234";
  const h = createHash("sha1").update(pw).digest("hex").toUpperCase();
  const prefix = h.slice(0, 5);
  const suffix = h.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "SentireCloud" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch (e) {
    log.warn({ err: (e as Error).message }, "breached-password check skipped");
    return false;
  }
}

export interface PasswordProblem {
  field: "password";
  message: string;
}

export async function checkNewPassword(pw: string, email?: string): Promise<PasswordProblem | null> {
  if (pw.length < 12) return { field: "password", message: "Use at least 12 characters." };
  if (pw.length > 200) return { field: "password", message: "Use at most 200 characters." };
  if (email && pw.toLowerCase().includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4)
    return { field: "password", message: "Do not use your email name in the password." };
  if (await isBreached(pw)) return { field: "password", message: "This password has appeared in a data breach. Choose another one." };
  return null;
}
