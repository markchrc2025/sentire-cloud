import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { loadSession, SESSION_COOKIE, SESSION_DAYS, type LoadedSession } from "../account/sessions";
import { myOrganizations } from "../account/orgs";
import { hasSecondFactor } from "../account/mfa";
import { orgContext, type OrgContext } from "../db/dal";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function deviceLabel(): Promise<string | null> {
  const ua = (await headers()).get("user-agent") ?? "";
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "unknown system";
  return `${browser} on ${os}`;
}

export async function setSessionCookie(token: string, pending = false) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: pending ? 600 : SESSION_DAYS * 86_400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentSession(opts?: { allowPending?: boolean }): Promise<LoadedSession | null> {
  return loadSession((await cookies()).get(SESSION_COOKIE)?.value, opts);
}

export async function requireSession(next?: string): Promise<LoadedSession> {
  const s = await currentSession();
  if (!s) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return s;
}

/** Owners and Sentire staff must have a second factor (FR-02). */
export async function mustSetUpSecondFactor(s: LoadedSession) {
  const orgs = await myOrganizations(s.user.id);
  const needs = s.user.platformRole !== "NONE" || orgs.some((o) => o.role === "OWNER");
  return needs && !(await hasSecondFactor(s.user.id));
}

/** Current organization for the portal: the session's choice, else the first one. */
export async function requireOrg(): Promise<{ s: LoadedSession; ctx: OrgContext; orgs: Awaited<ReturnType<typeof myOrganizations>>; current: Awaited<ReturnType<typeof myOrganizations>>[number] }> {
  const s = await requireSession("/org");
  if (await mustSetUpSecondFactor(s)) redirect("/account/security?required=1");
  const orgs = await myOrganizations(s.user.id);
  if (orgs.length === 0) redirect("/onboarding");
  const current = orgs.find((o) => o.org.id === s.session.currentOrganizationId) ?? orgs[0]!;
  return { s, orgs, current, ctx: orgContext({ organizationId: current.org.id, actorId: s.user.id, actorKind: "user", ip: await clientIp() }) };
}

export function safeNext(next: string | null | undefined, fallback = "/org"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
