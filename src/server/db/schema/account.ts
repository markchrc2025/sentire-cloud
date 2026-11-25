import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, ts, updatedAt } from "./common";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    name: text().notNull(),
    passwordHash: text(),
    status: text({ enum: ["UNVERIFIED", "ACTIVE", "LOCKED", "DISABLED"] }).notNull().default("UNVERIFIED"),
    platformRole: text({ enum: ["NONE", "PLATFORM_ADMIN", "SUPPORT"] }).notNull().default("NONE"),
    failedSignIns: integer().notNull().default(0),
    lockedUntil: ts(),
    lastSignInAt: ts(),
    termsAcceptedAt: ts(),
    marketingConsentAt: ts(),
    deletionRequestedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const mfaFactors = pgTable(
  "mfa_factors",
  {
    id: id(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text({ enum: ["TOTP", "PASSKEY", "RECOVERY_CODES"] }).notNull(),
    label: text().notNull(),
    /** TOTP: encrypted secret. RECOVERY_CODES: JSON array of sha256 hashes (used ones removed). PASSKEY: public key (base64url). */
    secret: text().notNull(),
    credentialId: text(),
    counter: integer().notNull().default(0),
    transports: jsonb().$type<string[]>(),
    lastTimeStep: integer(),
    confirmedAt: ts(),
    lastUsedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), uniqueIndex().on(t.credentialId)],
);

/** Sentire Cloud web sessions. The cookie holds the token; only its hash is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text().notNull(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Password done, second factor still needed. */
    pendingMfa: boolean().notNull().default(false),
    currentOrganizationId: text(),
    deviceLabel: text(),
    ipAddress: text(),
    lastSeenAt: createdAt(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tokenHash), index().on(t.userId)],
);

/** One-time email links (verify, reset, invitation acceptance is separate). Only the hash is stored. */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: id(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text({ enum: ["VERIFY", "RESET"] }).notNull(),
    tokenHash: text().notNull(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tokenHash)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    registeredName: text().notNull(),
    tradeName: text(),
    tin: text().notNull(),
    branchCode: text().notNull().default("00000"),
    address: text().notNull(),
    vatStatus: text({ enum: ["VAT", "NON_VAT"] }).notNull(),
    industry: text(),
    billingEmail: text().notNull(),
    phone: text(),
    status: text({ enum: ["ACTIVE", "SUSPENDED", "CLOSED"] }).notNull().default("ACTIVE"),
    flaggedDuplicateTin: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.tin, t.branchCode)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: text().notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text({ enum: ["OWNER", "ADMIN", "BILLING", "MEMBER"] }).notNull(),
    status: text({ enum: ["ACTIVE", "REMOVED"] }).notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.userId), index().on(t.userId)],
);

export const appAccess = pgTable(
  "app_access",
  {
    organizationId: text().notNull().references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: text().notNull().references(() => memberships.id, { onDelete: "cascade" }),
    appId: text().notNull(),
    allowed: boolean().notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.appId] }), index().on(t.organizationId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: text().notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text({ enum: ["OWNER", "ADMIN", "BILLING", "MEMBER"] }).notNull(),
    appIds: jsonb().$type<string[]>().notNull().default([]),
    tokenHash: text().notNull(),
    invitedBy: text().notNull(),
    status: text({ enum: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] }).notNull().default("PENDING"),
    expiresAt: ts().notNull(),
    acceptedBy: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tokenHash), index().on(t.organizationId)],
);

/** Emails sent (or queued). Kept for audit and for the staging outbox. */
export const outboundEmails = pgTable(
  "outbound_emails",
  {
    id: id(),
    to: text().notNull(),
    subject: text().notNull(),
    text: text().notNull(),
    html: text(),
    template: text().notNull(),
    status: text({ enum: ["QUEUED", "SENT", "FAILED", "LOGGED"] }).notNull().default("QUEUED"),
    providerRef: text(),
    error: text(),
    createdAt: createdAt(),
    sentAt: ts(),
  },
  (t) => [index().on(t.to, t.createdAt)],
);

/** Fixed-window rate limits (sign-in, reset, invite, webhooks). */
export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  windowStart: ts().notNull(),
  count: integer().notNull(),
});

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: id(),
  userId: text().notNull(),
  purpose: text({ enum: ["REGISTER", "AUTHENTICATE"] }).notNull(),
  challenge: text().notNull(),
  expiresAt: ts().notNull(),
  createdAt: createdAt(),
});
