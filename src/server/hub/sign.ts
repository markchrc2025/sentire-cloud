import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/** sentire.event.v1 signature, same as Sentire Framework (frappe/sentire.py) and sentire-kit. */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifySignature(secrets: string[], header: string | null, body: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  return secrets.some((s) => safeEqual(parts.v1!, createHmac("sha256", s).update(`${t}.${body}`).digest("hex")));
}
