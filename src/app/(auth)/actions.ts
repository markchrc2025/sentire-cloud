"use server";

import { redirect } from "next/navigation";
import { FormError, completeSecondFactor, requestPasswordReset, resendVerification, resetPassword, signIn, signUp } from "@/server/account/service";
import { RateLimitedError } from "@/server/ratelimit";
import { clearSessionCookie, clientIp, currentSession, deviceLabel, safeNext, setSessionCookie } from "@/server/http/session";
import { revokeSession } from "@/server/account/sessions";
import { endAppSessions } from "@/server/oidc";
import { acceptInvitation } from "@/server/account/orgs";
import { setCurrentOrganization } from "@/server/account/sessions";
import { audit } from "@/server/audit";

function back(path: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  redirect(`${path}?${q.toString()}`);
}

function message(e: unknown) {
  if (e instanceof FormError || e instanceof RateLimitedError) return e.message;
  throw e;
}

export async function signUpAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const next = String(fd.get("next") ?? "");
  try {
    await signUp({
      name: String(fd.get("name") ?? ""),
      email,
      password: String(fd.get("password") ?? ""),
      acceptTerms: fd.get("acceptTerms") === "on",
      marketing: fd.get("marketing") === "on",
      ip: await clientIp(),
    });
  } catch (e) {
    back("/sign-up", { error: message(e), email, name: String(fd.get("name") ?? ""), next });
  }
  back("/check-email", { email, next });
}

export async function resendAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  try {
    await resendVerification(email, await clientIp());
  } catch (e) {
    back("/check-email", { email, error: message(e) });
  }
  back("/check-email", { email, ok: "We sent a new link." });
}

export async function signInAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const next = safeNext(String(fd.get("next") ?? ""));
  let r;
  try {
    r = await signIn({ email, password: String(fd.get("password") ?? ""), ip: await clientIp(), device: await deviceLabel() });
  } catch (e) {
    return back("/sign-in", { error: message(e), email, next });
  }
  if (r.status === "error") return back("/sign-in", { error: r.message, email, next });
  if (r.status === "unverified") return back("/check-email", { email, error: "Confirm your email first. We can send a new link." });
  await setSessionCookie(r.token, r.status === "mfa");
  if (r.status === "mfa") return back("/sign-in/two-factor", { next });
  redirect(next);
}

export async function twoFactorAction(fd: FormData) {
  const next = safeNext(String(fd.get("next") ?? ""));
  const pending = await currentSession({ allowPending: true });
  if (!pending?.session.pendingMfa) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const passkeyJson = String(fd.get("passkey") ?? "");
  let r;
  try {
    r = await completeSecondFactor(
      { sessionId: pending.session.id, userId: pending.user.id },
      passkeyJson ? { passkey: JSON.parse(passkeyJson) } : { code: String(fd.get("code") ?? "") },
      await clientIp(),
      await deviceLabel(),
    );
  } catch (e) {
    return back("/sign-in/two-factor", { error: message(e), next });
  }
  if (r.status !== "ok") return back("/sign-in/two-factor", { error: r.status === "error" ? r.message : "Try again.", next });
  await setSessionCookie(r.token);
  redirect(next);
}

export async function forgotAction(fd: FormData) {
  const email = String(fd.get("email") ?? "");
  try {
    await requestPasswordReset(email, await clientIp());
  } catch (e) {
    back("/forgot", { error: message(e), email });
  }
  back("/forgot", { ok: "If that email has a Sentire Account, a reset link is on its way. It works for 1 hour." });
}

export async function resetAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  try {
    await resetPassword(token, String(fd.get("password") ?? ""), await clientIp());
  } catch (e) {
    back("/reset", { token, error: message(e) });
  }
  back("/sign-in", { ok: "Your password is changed. Sign in with the new one." });
}

/** Signing out of Sentire Cloud signs the user out of every app (FR-03). */
export async function signOutAction() {
  const s = await currentSession({ allowPending: true });
  if (s) {
    await revokeSession(s.session.id, s.user.id);
    await endAppSessions(s.user.id);
    await audit({ actorId: s.user.id, action: "user.signed_out", entity: "user", entityId: s.user.id });
  }
  await clearSessionCookie();
  redirect("/sign-in?ok=You+are+signed+out+of+Sentire+Cloud+and+every+Sentire+app.");
}

export async function acceptInviteAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const s = await currentSession();
  if (!s) redirect(`/sign-in?next=${encodeURIComponent(`/invite?token=${token}`)}`);
  try {
    const { organizationId } = await acceptInvitation(token, { id: s.user.id, email: s.user.email });
    await setCurrentOrganization(s.session.id, organizationId);
  } catch (e) {
    back("/invite", { token, error: message(e) });
  }
  redirect("/org?ok=Welcome.+You+joined+the+organization.");
}
