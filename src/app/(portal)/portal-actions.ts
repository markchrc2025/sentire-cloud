"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { FormError, changePassword, requestAccountDeletion, setMarketingConsent } from "@/server/account/service";
import {
  ForbiddenError,
  changeRole,
  createOrganization,
  inviteMember,
  leaveOrganization,
  myOrganizations,
  removeMember,
  revokeInvitation,
  setAppAccess,
  transferOwnership,
  updateOrganization,
  type OrgRole,
} from "@/server/account/orgs";
import { confirmTotp, regenerateRecoveryCodes, removeFactor, startTotp } from "@/server/account/mfa";
import { finishPasskeyRegistration } from "@/server/account/passkeys";
import { revokeSession, setCurrentOrganization } from "@/server/account/sessions";
import { RateLimitedError } from "@/server/ratelimit";
import { clientIp, requireOrg, requireSession } from "@/server/http/session";
import { listApps } from "@/server/account/registry";

function go(path: string, params: Record<string, string | undefined> = {}): never {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  redirect(q.size ? `${path}?${q}` : path);
}

/** Recovery codes are shown once, from a short-lived cookie (never in the address bar). */
async function flashCodes(codes: string[] | null | undefined) {
  if (!codes?.length) return undefined;
  (await cookies()).set("sc_codes", codes.join(","), { httpOnly: true, sameSite: "strict", path: "/account/security", maxAge: 120, secure: process.env.NODE_ENV === "production" });
  return "1";
}

function msg(e: unknown): string {
  if (e instanceof FormError || e instanceof ForbiddenError || e instanceof RateLimitedError) return e.message;
  throw e;
}

function profileFrom(fd: FormData) {
  return {
    registeredName: String(fd.get("registeredName") ?? ""),
    tradeName: String(fd.get("tradeName") ?? ""),
    tin: String(fd.get("tin") ?? ""),
    branchCode: String(fd.get("branchCode") ?? ""),
    address: String(fd.get("address") ?? ""),
    vatStatus: (String(fd.get("vatStatus") ?? "NON_VAT") === "VAT" ? "VAT" : "NON_VAT") as "VAT" | "NON_VAT",
    industry: String(fd.get("industry") ?? ""),
    billingEmail: String(fd.get("billingEmail") ?? ""),
    phone: String(fd.get("phone") ?? ""),
  };
}

export async function switchOrgAction(fd: FormData) {
  const s = await requireSession();
  const id = String(fd.get("organizationId") ?? "");
  const mine = await myOrganizations(s.user.id);
  if (mine.some((o) => o.org.id === id)) await setCurrentOrganization(s.session.id, id);
  go("/org");
}

export async function createOrgAction(fd: FormData) {
  const s = await requireSession("/onboarding");
  const apps = (await listApps()).map((a) => a.appId);
  let orgId: string;
  try {
    const org = await createOrganization(s.user.id, profileFrom(fd), apps, await clientIp());
    orgId = org.id;
  } catch (e) {
    return go("/onboarding", { error: msg(e) });
  }
  await setCurrentOrganization(s.session.id, orgId);
  go("/account/security", { required: "1", ok: "Your organization is ready. As its Owner, turn on two-factor sign-in to continue." });
}

export async function updateOrgAction(fd: FormData) {
  const { ctx } = await requireOrg();
  try {
    await updateOrganization(ctx, profileFrom(fd));
  } catch (e) {
    return go("/org/settings", { error: msg(e) });
  }
  go("/org/settings", { ok: "Saved." });
}

const ROLES: OrgRole[] = ["OWNER", "ADMIN", "BILLING", "MEMBER"];
function role(v: FormDataEntryValue | null): OrgRole {
  const r = String(v ?? "MEMBER") as OrgRole;
  return ROLES.includes(r) ? r : "MEMBER";
}

export async function inviteAction(fd: FormData) {
  const { ctx } = await requireOrg();
  try {
    await inviteMember(ctx, { email: String(fd.get("email") ?? ""), role: role(fd.get("role")), appIds: fd.getAll("apps").map(String) });
  } catch (e) {
    return go("/org/members", { error: msg(e) });
  }
  go("/org/members", { ok: "Invitation sent." });
}

export async function revokeInviteAction(fd: FormData) {
  const { ctx } = await requireOrg();
  try {
    await revokeInvitation(ctx, String(fd.get("id")));
  } catch (e) {
    return go("/org/members", { error: msg(e) });
  }
  go("/org/members", { ok: "Invitation withdrawn." });
}

export async function memberAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const id = String(fd.get("membershipId"));
  const op = String(fd.get("op"));
  try {
    if (op === "role") await changeRole(ctx, id, role(fd.get("role")));
    else if (op === "apps") await setAppAccess(ctx, id, fd.getAll("apps").map(String));
    else if (op === "remove") await removeMember(ctx, id);
    else if (op === "transfer") await transferOwnership(ctx, id);
  } catch (e) {
    return go("/org/members", { error: msg(e) });
  }
  revalidatePath("/org/members");
  go("/org/members", { ok: op === "remove" ? "Member removed. Their app sessions end within a minute." : "Saved." });
}

export async function leaveAction() {
  const { ctx, s } = await requireOrg();
  try {
    await leaveOrganization(ctx);
  } catch (e) {
    return go("/org/settings", { error: msg(e) });
  }
  await setCurrentOrganization(s.session.id, null);
  go("/org");
}

export async function changePasswordAction(fd: FormData) {
  const s = await requireSession();
  try {
    await changePassword(s.user.id, String(fd.get("current") ?? ""), String(fd.get("password") ?? ""), s.session.id);
  } catch (e) {
    return go("/account/security", { error: msg(e) });
  }
  go("/account/security", { ok: "Password changed. Other devices were signed out." });
}

export async function startTotpAction() {
  const s = await requireSession();
  const { factorId } = await startTotp(s.user.id, s.user.email);
  go("/account/security", { setup: factorId });
}

export async function confirmTotpAction(fd: FormData) {
  const s = await requireSession();
  const factorId = String(fd.get("factorId"));
  let codes: string[];
  try {
    const r = await confirmTotp(s.user.id, factorId, String(fd.get("code") ?? ""));
    if (!r.ok) return go("/account/security", { setup: factorId, error: "That code is not correct. Check the time on your phone and try again." });
    codes = r.recoveryCodes;
  } catch (e) {
    return go("/account/security", { error: msg(e) });
  }
  go("/account/security", { codes: await flashCodes(codes), ok: "Two-factor sign-in is on. Save your recovery codes now." });
}

export async function addPasskeyAction(fd: FormData) {
  const s = await requireSession();
  let codes: string[] | null;
  try {
    const r = await finishPasskeyRegistration(s.user.id, JSON.parse(String(fd.get("response") ?? "{}")), String(fd.get("label") ?? ""));
    codes = r.recoveryCodes;
  } catch (e) {
    return go("/account/security", { error: e instanceof Error ? e.message : "The passkey was not added." });
  }
  go("/account/security", { ok: "Passkey added.", codes: await flashCodes(codes) });
}

export async function newRecoveryCodesAction() {
  const s = await requireSession();
  const codes = await regenerateRecoveryCodes(s.user.id);
  go("/account/security", { codes: await flashCodes(codes), ok: "New recovery codes. The old ones no longer work." });
}

export async function removeFactorAction(fd: FormData) {
  const s = await requireSession();
  await removeFactor(s.user.id, String(fd.get("id")));
  go("/account/security", { ok: "Removed." });
}

export async function endSessionAction(fd: FormData) {
  const s = await requireSession();
  await revokeSession(String(fd.get("id")), s.user.id);
  go("/account/security", { ok: "Session ended." });
}

export async function privacyAction(fd: FormData) {
  const s = await requireSession();
  await setMarketingConsent(s.user.id, fd.get("marketing") === "on");
  go("/account", { ok: "Saved." });
}

export async function deletionAction() {
  const s = await requireSession();
  await requestAccountDeletion(s.user.id);
  go("/account", { ok: "We received your request to delete your account. Sentire will contact you within 15 days, as the Data Privacy Act requires." });
}

