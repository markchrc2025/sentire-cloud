"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireStaff } from "@/server/admin/staff";
import { parsePHP } from "@/lib/money";
import { issueCreditNote, recordBankTransfer, recordInvoiceNumber, recordRefund, voidStatement } from "@/server/billing/payments";
import { reviewCertificate } from "@/server/billing/withholding";
import { addOverride, addPriceVersion, extendGrace, removeOverride, rotateSecret, setAddOnOnSale, setPlatformRole, updateApp, updateSeller } from "@/server/admin/actions-core";
import { resend } from "@/server/hub/deliver";

function back(path: string, kind: "ok" | "error", text: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
}

async function run(path: string, ok: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    back(path, "error", (e as Error).message);
  }
  back(path, "ok", ok);
}

export async function stmtAction(fd: FormData) {
  const s = await requireStaff(true);
  const id = String(fd.get("statementId"));
  const op = String(fd.get("op"));
  const path = `/admin/statements/${id}`;
  const amount = () => parsePHP(String(fd.get("amount") ?? "0"));
  if (op === "bank") return run(path, "Payment recorded.", () => recordBankTransfer(s.user.id, { statementId: id, amountCentavos: amount(), reference: String(fd.get("reference")), atc: String(fd.get("atc") ?? "") || null }));
  if (op === "credit") return run(path, "Credit note issued.", () => issueCreditNote(s.user.id, { statementId: id, amountCentavos: amount(), reason: String(fd.get("reason")) }));
  if (op === "refund") return run(path, "Refund recorded.", () => recordRefund(s.user.id, { statementId: id, amountCentavos: amount(), reason: String(fd.get("reason")), reference: String(fd.get("reference")) }));
  if (op === "void") return run(path, "Voided.", () => voidStatement(s.user.id, id, String(fd.get("reason"))));
  if (op === "invoice") return run(path, "Invoice number saved.", () => recordInvoiceNumber(s.user.id, id, String(fd.get("invoice"))));
}

export async function whtAction(fd: FormData) {
  const s = await requireStaff(true);
  const accept = fd.get("accept") === "1";
  return run("/admin/withholdings", accept ? "Accepted." : "Rejected.", () => reviewCertificate(s.user.id, String(fd.get("id")), accept, String(fd.get("reason") ?? "") || undefined));
}

export async function orgAdminAction(fd: FormData) {
  const s = await requireStaff(true);
  const org = String(fd.get("organizationId"));
  const path = `/admin/orgs/${org}`;
  const op = String(fd.get("op"));
  if (op === "grace") return run(path, "Grace extended.", () => extendGrace(s.user.id, String(fd.get("subscriptionId")), String(fd.get("until")), String(fd.get("reason"))));
  if (op === "override")
    return run(path, "Override saved.", () =>
      addOverride(s.user.id, {
        organizationId: org,
        appId: String(fd.get("appId")),
        features: String(fd.get("features") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
        forceState: (String(fd.get("forceState") ?? "") || null) as "ACTIVE" | "READ_ONLY" | "OFF" | null,
        reason: String(fd.get("reason")),
        expiresAt: fd.get("expiresAt") ? new Date(`${fd.get("expiresAt")}T23:59:59+08:00`) : null,
      }),
    );
  if (op === "unoverride") return run(path, "Override removed.", () => removeOverride(s.user.id, String(fd.get("id"))));
  if (op === "resend") return run(path, "Queued again.", () => resend(String(fd.get("id"))));
  if (op === "staff") return run(path, "Role saved.", () => setPlatformRole(s.user.id, String(fd.get("userId")), String(fd.get("role")) as "NONE"));
}

export async function catalogAction(fd: FormData) {
  const s = await requireStaff(true);
  const op = String(fd.get("op"));
  if (op === "seller")
    return run("/admin/catalog", "Seller saved.", () =>
      updateSeller(s.user.id, {
        registeredName: String(fd.get("registeredName")),
        tradeName: String(fd.get("tradeName") ?? "") || null,
        tin: String(fd.get("tin")),
        branchCode: String(fd.get("branchCode") ?? "00000"),
        address: String(fd.get("address")),
        taxStatus: fd.get("taxStatus") === "VAT" ? "VAT" : "NON_VAT",
        bankDetails: String(fd.get("bankDetails") ?? "") || null,
        confirmed: fd.get("confirmed") === "on",
      }),
    );
  if (op === "price")
    return run("/admin/catalog", "Price saved.", () =>
      addPriceVersion(s.user.id, {
        planId: String(fd.get("planId") ?? "") || undefined,
        addOnId: String(fd.get("addOnId") ?? "") || undefined,
        cycle: fd.get("cycle") === "MONTHLY" ? "MONTHLY" : "ANNUAL",
        amountCentavos: parsePHP(String(fd.get("amount"))),
        setupFeeCentavos: parsePHP(String(fd.get("setup") || "0")),
        validFrom: String(fd.get("validFrom")),
      }),
    );
  if (op === "addon-sale") return run("/admin/catalog", "Saved.", () => setAddOnOnSale(s.user.id, String(fd.get("addOnId")), fd.get("onSale") === "1"));
}

export async function appAction(fd: FormData) {
  const s = await requireStaff(true);
  const appId = String(fd.get("appId"));
  const op = String(fd.get("op"));
  const list = (k: string) => String(fd.get(k) ?? "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const opt = (k: string) => String(fd.get(k) ?? "").trim() || null;
  if (op === "save")
    return run("/admin/apps", `${appId} saved.`, () =>
      updateApp(s.user.id, appId, { baseUrl: String(fd.get("baseUrl")), redirectUris: list("redirectUris"), postLogoutRedirectUris: list("postLogoutRedirectUris"), backchannelLogoutUri: opt("backchannelLogoutUri"), eventEndpoint: opt("eventEndpoint"), provisionUrl: opt("provisionUrl"), healthUrl: opt("healthUrl"), acceptsEvents: list("acceptsEvents") }),
    );
  if (op === "oidc" || op === "event") {
    let secret = "";
    try {
      secret = await rotateSecret(s.user.id, appId, op);
    } catch (e) {
      back("/admin/apps", "error", (e as Error).message);
    }
    (await cookies()).set("sc_secret", `${appId}:${op}:${secret}`, { httpOnly: true, sameSite: "strict", path: "/admin/apps", maxAge: 120, secure: process.env.NODE_ENV === "production" });
    back("/admin/apps", "ok", "New secret created. Copy it now; it is shown once.");
  }
}
