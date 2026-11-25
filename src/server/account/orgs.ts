import { shared } from "../shared";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomToken, sha256 } from "@/lib/crypto";
import { db } from "../db/client";
import { appAccess, invitations, memberships, organizations, users } from "../db/schema";
import { inOrg, type OrgContext } from "../db/dal";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { limit } from "../ratelimit";
import { sendMail } from "../mail/send";
import { templates } from "../mail/templates";
import { FormError, findUserByEmail } from "./service";

export type OrgRole = "OWNER" | "ADMIN" | "BILLING" | "MEMBER";

export const orgProfileSchema = z.object({
  registeredName: z.string().trim().min(2, "Enter the registered name."),
  tradeName: z.string().trim().optional().transform((v) => v || null),
  tin: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^0-9]/g, ""))
    .refine((v) => v.length === 9 || v.length === 12, "Enter the 9-digit TIN (or 12 digits with the branch code).")
    .transform((v) => v.slice(0, 9)),
  branchCode: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/[^0-9]/g, "").padStart(5, "0").slice(-5) : "00000")),
  address: z.string().trim().min(5, "Enter the registered business address."),
  vatStatus: z.enum(["VAT", "NON_VAT"]),
  industry: z.string().trim().optional().transform((v) => v || null),
  billingEmail: z.string().trim().toLowerCase().email("Enter a valid billing email."),
  phone: z.string().trim().optional().transform((v) => v || null),
});
export type OrgProfile = z.input<typeof orgProfileSchema>;

export function formatTin(tin: string, branch: string) {
  return `${tin.slice(0, 3)}-${tin.slice(3, 6)}-${tin.slice(6, 9)}-${branch}`;
}

function parseProfile(input: OrgProfile) {
  const r = orgProfileSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new FormError(i.message, String(i.path[0] ?? ""));
  }
  return r.data;
}

/** UC-01 steps 5 to 6. Every app is allowed for the Owner by default. */
export async function createOrganization(userId: string, input: OrgProfile, appIds: string[], ip?: string | null) {
  const p = parseProfile(input);
  return db().transaction(async (tx) => {
    const dup = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.tin, p.tin), eq(organizations.branchCode, p.branchCode)))
      .limit(1);
    const [org] = await tx.insert(organizations).values({ ...p, flaggedDuplicateTin: dup.length > 0 }).returning();
    const [m] = await tx.insert(memberships).values({ organizationId: org!.id, userId, role: "OWNER" }).returning();
    if (appIds.length) await tx.insert(appAccess).values(appIds.map((appId) => ({ organizationId: org!.id, membershipId: m!.id, appId })));
    await audit({ organizationId: org!.id, actorId: userId, action: "organization.created", entity: "organization", entityId: org!.id, after: org, ip }, tx);
    await publish("account.organization.created", org!.id, { organizationId: org!.id, registeredName: org!.registeredName, tin: formatTin(org!.tin, org!.branchCode), vatStatus: org!.vatStatus }, tx);
    await publish("account.member.added", org!.id, { organizationId: org!.id, userId, role: "OWNER", appIds }, tx);
    return org!;
  });
}

export async function myOrganizations(userId: string) {
  return db()
    .select({ org: organizations, role: memberships.role, membershipId: memberships.id })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")))
    .orderBy(organizations.registeredName);
}

/** The caller's active membership in the context organization, or null. */
export async function membershipOf(ctx: OrgContext, userId: string) {
  const [m] = await db()
    .select()
    .from(memberships)
    .where(inOrg(ctx, memberships.organizationId, eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
  return m ?? null;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

export async function requireRole(ctx: OrgContext, roles: OrgRole[]) {
  if (!ctx.actorId) throw new ForbiddenError();
  const m = await membershipOf(ctx, ctx.actorId);
  if (!m || !roles.includes(m.role)) throw new ForbiddenError();
  return m;
}

export async function getOrganization(ctx: OrgContext) {
  const [o] = await db().select().from(organizations).where(inOrg(ctx, organizations.id));
  return o ?? null;
}

export async function updateOrganization(ctx: OrgContext, input: OrgProfile) {
  await requireRole(ctx, ["OWNER", "ADMIN"]);
  const p = parseProfile(input);
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(organizations).where(inOrg(ctx, organizations.id));
    const [after] = await tx.update(organizations).set(p).where(inOrg(ctx, organizations.id)).returning();
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "organization.updated", entity: "organization", entityId: ctx.organizationId, before, after, ip: ctx.ip }, tx);
    await publish("account.organization.updated", ctx.organizationId, { organizationId: ctx.organizationId, registeredName: after!.registeredName, tin: formatTin(after!.tin, after!.branchCode), vatStatus: after!.vatStatus }, tx);
    return after!;
  });
}

export async function listMembers(ctx: OrgContext) {
  const rows = await db()
    .select({ membership: memberships, user: { id: users.id, name: users.name, email: users.email, lastSignInAt: users.lastSignInAt } })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inOrg(ctx, memberships.organizationId, eq(memberships.status, "ACTIVE")))
    .orderBy(users.name);
  const access = await db().select().from(appAccess).where(inOrg(ctx, appAccess.organizationId));
  return rows.map((r) => ({ ...r, apps: access.filter((a) => a.membershipId === r.membership.id && a.allowed).map((a) => a.appId) }));
}

export async function listInvitations(ctx: OrgContext) {
  return db()
    .select()
    .from(invitations)
    .where(inOrg(ctx, invitations.organizationId, eq(invitations.status, "PENDING")))
    .orderBy(invitations.createdAt);
}

/** Seat check per app; filled in by entitlements (Phase 3). Returns the apps whose seat limit would be exceeded. */
export type SeatCheck = (ctx: OrgContext, appIds: string[], extra: number) => Promise<string[]>;
const seatBox = shared("seatCheck", () => ({ fn: (async () => []) as SeatCheck }));
export function setSeatCheck(fn: SeatCheck) {
  seatBox.fn = fn;
}

/** UC-03 steps 1 to 3. */
export async function inviteMember(ctx: OrgContext, input: { email: string; role: OrgRole; appIds: string[] }) {
  const inviter = await requireRole(ctx, ["OWNER", "ADMIN"]);
  if (input.role === "OWNER" && inviter.role !== "OWNER") throw new ForbiddenError("Only an Owner can invite another Owner.");
  const email = z.string().trim().toLowerCase().email().safeParse(input.email);
  if (!email.success) throw new FormError("Enter a valid email address.", "email");
  await limit(`invite:${ctx.organizationId}`, 50, 3600);
  const over = await seatBox.fn(ctx, input.appIds, 1);
  if (over.length) throw new FormError(`Your plan has no free seat for: ${over.join(", ")}. Upgrade the plan or remove a member first.`, "appIds");
  const existingUser = await findUserByEmail(email.data);
  if (existingUser && (await membershipOf(ctx, existingUser.id))) throw new FormError("This person is already a member.", "email");
  const token = randomToken();
  const [org] = await db().select().from(organizations).where(inOrg(ctx, organizations.id));
  const [me] = await db().select().from(users).where(eq(users.id, ctx.actorId!));
  return db().transaction(async (tx) => {
    await tx
      .update(invitations)
      .set({ status: "REVOKED" })
      .where(inOrg(ctx, invitations.organizationId, eq(invitations.email, email.data), eq(invitations.status, "PENDING")));
    const [inv] = await tx
      .insert(invitations)
      .values({
        organizationId: ctx.organizationId,
        email: email.data,
        role: input.role,
        appIds: input.appIds,
        tokenHash: sha256(token),
        invitedBy: ctx.actorId!,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.invited", entity: "invitation", entityId: inv!.id, after: { email: email.data, role: input.role, appIds: input.appIds }, ip: ctx.ip }, tx);
    await sendMail({ to: email.data, ...templates.invite(org!.tradeName ?? org!.registeredName, me!.name, token) });
    return inv!;
  });
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string) {
  await requireRole(ctx, ["OWNER", "ADMIN"]);
  await db().update(invitations).set({ status: "REVOKED" }).where(inOrg(ctx, invitations.organizationId, eq(invitations.id, invitationId)));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.invitation_revoked", entity: "invitation", entityId: invitationId, ip: ctx.ip });
}

export async function findInvitation(token: string) {
  const [inv] = await db()
    .select({ inv: invitations, org: organizations })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(eq(invitations.tokenHash, sha256(token)));
  if (!inv) return null;
  if (inv.inv.status === "PENDING" && inv.inv.expiresAt < new Date()) {
    await db().update(invitations).set({ status: "EXPIRED" }).where(eq(invitations.id, inv.inv.id));
    return { ...inv, inv: { ...inv.inv, status: "EXPIRED" as const } };
  }
  return inv;
}

/** UC-03 steps 4 to 5. The invite goes to an email; any signed-in account with that email can accept. */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const found = await findInvitation(token);
  if (!found || found.inv.status !== "PENDING") throw new FormError("This invitation is no longer valid. Ask for a new one.");
  if (found.inv.email.toLowerCase() !== user.email.toLowerCase())
    throw new FormError(`This invitation was sent to ${found.inv.email}. Sign in with that email to accept it.`);
  const { inv } = found;
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, inv.organizationId), eq(memberships.userId, user.id)));
    let m;
    if (existing) {
      [m] = await tx.update(memberships).set({ role: inv.role, status: "ACTIVE" }).where(eq(memberships.id, existing.id)).returning();
      await tx.delete(appAccess).where(eq(appAccess.membershipId, existing.id));
    } else {
      [m] = await tx.insert(memberships).values({ organizationId: inv.organizationId, userId: user.id, role: inv.role }).returning();
    }
    if (inv.appIds.length) await tx.insert(appAccess).values(inv.appIds.map((appId) => ({ organizationId: inv.organizationId, membershipId: m!.id, appId })));
    await tx.update(invitations).set({ status: "ACCEPTED", acceptedBy: user.id }).where(eq(invitations.id, inv.id));
    await audit({ organizationId: inv.organizationId, actorId: user.id, action: "member.joined", entity: "membership", entityId: m!.id, after: { role: inv.role, appIds: inv.appIds } }, tx);
    await publish("account.member.added", inv.organizationId, { organizationId: inv.organizationId, userId: user.id, role: inv.role, appIds: inv.appIds }, tx);
    return { organizationId: inv.organizationId };
  });
}

async function ownerCount(ctx: OrgContext) {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(inOrg(ctx, memberships.organizationId, eq(memberships.role, "OWNER"), eq(memberships.status, "ACTIVE")));
  return r?.n ?? 0;
}

async function targetMembership(ctx: OrgContext, membershipId: string) {
  const [m] = await db().select().from(memberships).where(inOrg(ctx, memberships.organizationId, eq(memberships.id, membershipId)));
  if (!m || m.status !== "ACTIVE") throw new FormError("Member not found.");
  return m;
}

/** FR-10: change role. Only an Owner can make or unmake an Owner; there is always at least one Owner. */
export async function changeRole(ctx: OrgContext, membershipId: string, role: OrgRole) {
  const me = await requireRole(ctx, ["OWNER", "ADMIN"]);
  const m = await targetMembership(ctx, membershipId);
  if ((m.role === "OWNER" || role === "OWNER") && me.role !== "OWNER") throw new ForbiddenError("Only an Owner can change Owners.");
  if (m.role === "OWNER" && role !== "OWNER" && (await ownerCount(ctx)) <= 1) throw new FormError("An organization needs at least one Owner. Transfer ownership first.");
  await db().transaction(async (tx) => {
    await tx.update(memberships).set({ role }).where(eq(memberships.id, m.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.role_changed", entity: "membership", entityId: m.id, before: { role: m.role }, after: { role }, ip: ctx.ip }, tx);
    await publish("account.member.updated", ctx.organizationId, { organizationId: ctx.organizationId, userId: m.userId, role }, tx);
  });
}

/** FR-09: which apps a member may open. */
export async function setAppAccess(ctx: OrgContext, membershipId: string, appIds: string[]) {
  await requireRole(ctx, ["OWNER", "ADMIN"]);
  const m = await targetMembership(ctx, membershipId);
  const current = (await db().select().from(appAccess).where(inOrg(ctx, appAccess.organizationId, eq(appAccess.membershipId, m.id), eq(appAccess.allowed, true)))).map((a) => a.appId);
  const added = appIds.filter((a) => !current.includes(a));
  const over = await seatBox.fn(ctx, added, 1);
  if (over.length) throw new FormError(`Your plan has no free seat for: ${over.join(", ")}.`);
  await db().transaction(async (tx) => {
    await tx.delete(appAccess).where(inOrg(ctx, appAccess.organizationId, eq(appAccess.membershipId, m.id)));
    if (appIds.length) await tx.insert(appAccess).values(appIds.map((appId) => ({ organizationId: ctx.organizationId, membershipId: m.id, appId })));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.apps_changed", entity: "membership", entityId: m.id, before: { appIds: current }, after: { appIds }, ip: ctx.ip }, tx);
    await publish("account.member.updated", ctx.organizationId, { organizationId: ctx.organizationId, userId: m.userId, role: m.role, appIds }, tx);
  });
  const removed = current.filter((a) => !appIds.includes(a));
  if (removed.length) await memberAccessHooks.onAccessRemoved(m.userId, ctx.organizationId, removed);
}

/** OIDC registers here to end app sessions (FR-10). */
export const memberAccessHooks = {
  onAccessRemoved: async (_userId: string, _orgId: string, _appIds: string[] | "all") => {},
};

/** FR-10: remove a member; their app sessions for this organization end within 60 seconds. */
export async function removeMember(ctx: OrgContext, membershipId: string) {
  const me = await requireRole(ctx, ["OWNER", "ADMIN"]);
  const m = await targetMembership(ctx, membershipId);
  if (m.role === "OWNER" && me.role !== "OWNER") throw new ForbiddenError("Only an Owner can remove an Owner.");
  if (m.role === "OWNER" && (await ownerCount(ctx)) <= 1) throw new FormError("An organization needs at least one Owner.");
  await db().transaction(async (tx) => {
    await tx.update(memberships).set({ status: "REMOVED" }).where(eq(memberships.id, m.id));
    await tx.delete(appAccess).where(eq(appAccess.membershipId, m.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.removed", entity: "membership", entityId: m.id, before: { role: m.role }, ip: ctx.ip }, tx);
    await publish("account.member.removed", ctx.organizationId, { organizationId: ctx.organizationId, userId: m.userId }, tx);
  });
  await memberAccessHooks.onAccessRemoved(m.userId, ctx.organizationId, "all");
}

/** FR-11 */
export async function transferOwnership(ctx: OrgContext, toMembershipId: string) {
  const me = await requireRole(ctx, ["OWNER"]);
  const target = await targetMembership(ctx, toMembershipId);
  if (target.id === me.id) throw new FormError("You are already an Owner.");
  await db().transaction(async (tx) => {
    await tx.update(memberships).set({ role: "OWNER" }).where(eq(memberships.id, target.id));
    await tx.update(memberships).set({ role: "ADMIN" }).where(eq(memberships.id, me.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "organization.ownership_transferred", entity: "membership", entityId: target.id, before: { from: me.userId }, after: { to: target.userId }, ip: ctx.ip }, tx);
    await publish("account.member.updated", ctx.organizationId, { organizationId: ctx.organizationId, userId: target.userId, role: "OWNER" }, tx);
    await publish("account.member.updated", ctx.organizationId, { organizationId: ctx.organizationId, userId: me.userId, role: "ADMIN" }, tx);
  });
}

/** Apps a member may open in an organization. */
export async function allowedApps(userId: string, organizationId: string) {
  const rows = await db()
    .select({ appId: appAccess.appId })
    .from(appAccess)
    .innerJoin(memberships, eq(memberships.id, appAccess.membershipId))
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId), eq(memberships.status, "ACTIVE"), eq(appAccess.allowed, true)));
  return rows.map((r) => r.appId);
}

export async function leaveOrganization(ctx: OrgContext) {
  const me = await membershipOf(ctx, ctx.actorId!);
  if (!me) return;
  if (me.role === "OWNER" && (await ownerCount(ctx)) <= 1) throw new FormError("You are the only Owner. Transfer ownership before leaving.");
  await db().update(memberships).set({ status: "REMOVED" }).where(eq(memberships.id, me.id));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "member.left", entity: "membership", entityId: me.id, ip: ctx.ip });
  await publish("account.member.removed", ctx.organizationId, { organizationId: ctx.organizationId, userId: me.userId });
  await memberAccessHooks.onAccessRemoved(me.userId, ctx.organizationId, "all");
}

