import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { addOns, apps, entitlementOverrides, prices, sellerProfiles, subscriptions } from "../db/schema";
import { audit } from "../audit";
import { encrypt, randomToken } from "@/lib/crypto";
import { refreshEntitlement } from "../entitlements/compute";
import { manilaDate } from "@/lib/time";

export async function extendGrace(staffId: string, subscriptionId: string, until: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required.");
  const [s] = await db().update(subscriptions).set({ graceUntil: until }).where(eq(subscriptions.id, subscriptionId)).returning();
  await audit({ organizationId: s!.organizationId, actorId: staffId, actorKind: "staff", action: "subscription.grace_extended", entity: "subscription", entityId: subscriptionId, after: { until, reason } });
}

export async function addOverride(staffId: string, input: { organizationId: string; appId: string; features: string[]; forceState: "ACTIVE" | "READ_ONLY" | "OFF" | null; reason: string; expiresAt: Date | null }) {
  if (!input.reason.trim()) throw new Error("A reason is required.");
  const [o] = await db().insert(entitlementOverrides).values({ ...input, createdBy: staffId }).returning();
  await audit({ organizationId: input.organizationId, actorId: staffId, actorKind: "staff", action: "entitlement.override_added", entity: "entitlement_override", entityId: o!.id, after: input });
  await refreshEntitlement(input.organizationId, input.appId);
}

export async function removeOverride(staffId: string, id: string) {
  const [o] = await db().delete(entitlementOverrides).where(eq(entitlementOverrides.id, id)).returning();
  if (!o) return;
  await audit({ organizationId: o.organizationId, actorId: staffId, actorKind: "staff", action: "entitlement.override_removed", entity: "entitlement_override", entityId: id, before: o });
  await refreshEntitlement(o.organizationId, o.appId);
}

export async function updateSeller(staffId: string, input: { registeredName: string; tradeName: string | null; tin: string; branchCode: string; address: string; taxStatus: "VAT" | "NON_VAT"; bankDetails: string | null; confirmed: boolean }) {
  const tin = input.tin.replace(/\D/g, "").slice(0, 9);
  if (tin.length !== 9) throw new Error("Enter the 9-digit TIN.");
  const [before] = await db().select().from(sellerProfiles).where(eq(sellerProfiles.code, "sentire"));
  const [after] = await db().update(sellerProfiles).set({ ...input, tin }).where(eq(sellerProfiles.code, "sentire")).returning();
  await audit({ actorId: staffId, actorKind: "staff", action: "seller.updated", entity: "seller_profile", entityId: after!.id, before, after });
}

/** New price version from a date; existing subscriptions keep theirs until renewal (FR-13). */
export async function addPriceVersion(staffId: string, input: { planId?: string; addOnId?: string; cycle: "MONTHLY" | "ANNUAL"; amountCentavos: number; setupFeeCentavos: number; validFrom: string }) {
  if (input.validFrom < manilaDate()) throw new Error("A new price starts today or later.");
  const owner = input.planId ? eq(prices.planId, input.planId) : eq(prices.addOnId, input.addOnId!);
  const open = await db().select().from(prices).where(and(owner, eq(prices.cycle, input.cycle)));
  for (const p of open) if (!p.validTo || p.validTo >= input.validFrom) await db().update(prices).set({ validTo: prevDay(input.validFrom) }).where(eq(prices.id, p.id));
  const [p] = await db().insert(prices).values({ planId: input.planId ?? null, addOnId: input.addOnId ?? null, cycle: input.cycle, amountCentavos: input.amountCentavos, setupFeeCentavos: input.setupFeeCentavos, validFrom: input.validFrom }).returning();
  await audit({ actorId: staffId, actorKind: "staff", action: "price.added", entity: "price", entityId: p!.id, after: p });
}

function prevDay(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export async function setAddOnOnSale(staffId: string, addOnId: string, onSale: boolean) {
  await db().update(addOns).set({ onSale }).where(eq(addOns.id, addOnId));
  await audit({ actorId: staffId, actorKind: "staff", action: onSale ? "add_on.on_sale" : "add_on.off_sale", entity: "add_on", entityId: addOnId });
}

export async function updateApp(staffId: string, appId: string, input: { baseUrl: string; redirectUris: string[]; postLogoutRedirectUris: string[]; backchannelLogoutUri: string | null; eventEndpoint: string | null; provisionUrl: string | null; healthUrl: string | null; acceptsEvents: string[] }) {
  for (const u of [input.baseUrl, ...input.redirectUris, ...input.postLogoutRedirectUris, input.backchannelLogoutUri, input.eventEndpoint, input.provisionUrl].filter(Boolean) as string[]) {
    if (!/^https:\/\//.test(u) && !/^http:\/\/localhost/.test(u)) throw new Error(`Use https: ${u}`);
  }
  await db().update(apps).set(input).where(eq(apps.appId, appId));
  await audit({ actorId: staffId, actorKind: "staff", action: "app.updated", entity: "app", entityId: appId, after: input });
}

/** Returns the new secret once; only its encrypted form is kept. Event secrets keep the previous one valid during rotation. */
export async function rotateSecret(staffId: string, appId: string, which: "oidc" | "event") {
  const secret = randomToken(32);
  const [a] = await db().select().from(apps).where(eq(apps.appId, appId));
  if (!a) throw new Error("App not found.");
  if (which === "oidc") await db().update(apps).set({ oidcClientSecretEnc: encrypt(secret) }).where(eq(apps.appId, appId));
  else await db().update(apps).set({ eventSecretEnc: encrypt(secret), previousEventSecretEnc: a.eventSecretEnc }).where(eq(apps.appId, appId));
  await audit({ actorId: staffId, actorKind: "staff", action: `app.${which}_secret_rotated`, entity: "app", entityId: appId });
  return secret;
}

export async function setPlatformRole(staffId: string, userId: string, role: "NONE" | "PLATFORM_ADMIN" | "SUPPORT") {
  const { users } = await import("../db/schema");
  await db().update(users).set({ platformRole: role }).where(eq(users.id, userId));
  await audit({ actorId: staffId, actorKind: "staff", action: "staff.role_set", entity: "user", entityId: userId, after: { role } });
}
