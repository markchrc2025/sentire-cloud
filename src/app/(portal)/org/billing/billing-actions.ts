"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/server/http/session";
import { BillingError } from "@/server/billing/statements";
import { ForbiddenError } from "@/server/account/orgs";
import { changePlan, setAddOns, setCancelAtPeriodEnd, subscribe } from "@/server/billing/subscriptions";
import { startCheckout } from "@/server/billing/payments";
import { uploadCertificate } from "@/server/billing/withholding";

function go(path: string, params: Record<string, string | undefined> = {}): never {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  redirect(q.size ? `${path}?${q}` : path);
}
function msg(e: unknown) {
  if (e instanceof BillingError || e instanceof ForbiddenError) return e.message;
  throw e;
}

export async function subscribeAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const method = fd.get("method") === "BANK_TRANSFER" ? "BANK_TRANSFER" : "ONLINE";
  let statementId: string;
  try {
    const r = await subscribe(ctx, { planId: String(fd.get("planId")), cycle: fd.get("cycle") === "MONTHLY" ? "MONTHLY" : "ANNUAL", addOnIds: fd.getAll("addOns").map(String), method });
    statementId = r.statement.id;
  } catch (e) {
    return go("/org/billing/subscribe", { error: msg(e), product: String(fd.get("product") ?? "ledger") });
  }
  if (method === "BANK_TRANSFER") go(`/org/billing/statements/${statementId}`, { ok: "We emailed the billing statement. Pay by bank transfer within 7 days; your app is set up when the payment is recorded." });
  go(`/org/billing/statements/${statementId}`, { pay: "1" });
}

export async function payAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const id = String(fd.get("statementId"));
  let url: string;
  try {
    const atc = String(fd.get("atc") ?? "");
    url = (await startCheckout(ctx, id, { atc: atc || null, returnUrl: String(fd.get("returnUrl") ?? "") || null })).url;
  } catch (e) {
    return go(`/org/billing/statements/${id}`, { error: msg(e) });
  }
  redirect(url);
}

export async function changePlanAction(fd: FormData) {
  const { ctx } = await requireOrg();
  let to: string;
  try {
    const r = await changePlan(ctx, String(fd.get("subscriptionId")), { planId: String(fd.get("planId")), cycle: fd.get("cycle") === "MONTHLY" ? "MONTHLY" : fd.get("cycle") === "ANNUAL" ? "ANNUAL" : undefined });
    to = r.mode === "upgrade" ? `/org/billing/statements/${r.statement!.id}?pay=1` : `/org/billing?ok=${encodeURIComponent(`The new plan starts on ${r.on}.`)}`;
  } catch (e) {
    return go("/org/billing", { error: msg(e) });
  }
  redirect(to);
}

export async function addOnsAction(fd: FormData) {
  const { ctx } = await requireOrg();
  let to = "/org/billing?ok=Saved.";
  try {
    const r = await setAddOns(ctx, String(fd.get("subscriptionId")), fd.getAll("addOns").map(String));
    if (r.statement && r.statement.status !== "PAID") to = `/org/billing/statements/${r.statement.id}?pay=1`;
  } catch (e) {
    return go("/org/billing", { error: msg(e) });
  }
  redirect(to);
}

export async function cancelAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const cancel = fd.get("cancel") === "1";
  try {
    await setCancelAtPeriodEnd(ctx, String(fd.get("subscriptionId")), cancel);
  } catch (e) {
    return go("/org/billing", { error: msg(e) });
  }
  go("/org/billing", { ok: cancel ? "Your subscription ends at the end of the paid period. You can undo this until then." : "Your subscription continues." });
}

export async function uploadCertificateAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) go("/org/billing", { error: "Choose the 2307 file." });
  try {
    await uploadCertificate(ctx, String(fd.get("withholdingId")), { name: f.name, type: f.type, body: Buffer.from(await f.arrayBuffer()) });
  } catch (e) {
    return go("/org/billing", { error: msg(e) });
  }
  go("/org/billing", { ok: "Thank you. Sentire will check the certificate." });
}
