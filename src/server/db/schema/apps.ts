import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./common";

/** App registry (FR-27). Each Sentire app, its OIDC client and contracts. */
export const apps = pgTable("apps", {
  id: id(),
  appId: text().notNull().unique(), // ledger, payroll, projects, helpdesk, lms, pms, test
  name: text().notNull(),
  engine: text({ enum: ["PYTHON_FRAMEWORK", "TYPESCRIPT_KIT"] }).notNull(),
  baseUrl: text().notNull(),
  oidcClientId: text().notNull().unique(),
  oidcClientSecretEnc: text(), // encrypted; shown once when created or rotated
  redirectUris: jsonb().$type<string[]>().notNull().default([]),
  postLogoutRedirectUris: jsonb().$type<string[]>().notNull().default([]),
  backchannelLogoutUri: text(),
  eventEndpoint: text(),
  /** Signing secret for events between Sentire Cloud and this app (sentire.event.v1), encrypted. Two during rotation. */
  eventSecretEnc: text(),
  previousEventSecretEnc: text(),
  provisionUrl: text(),
  /** Multi-site apps (Ledger): paths on each organization's instance. */
  instancePaths: jsonb().$type<{ events?: string; callback?: string; export?: string; delete?: string; suspend?: string; resume?: string; health?: string }>().notNull().default({}),
  healthUrl: text(),
  sendsEvents: jsonb().$type<string[]>().notNull().default([]),
  acceptsEvents: jsonb().$type<string[]>().notNull().default([]),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Storage for node-oidc-provider models (sessions, codes, tokens, grants, interactions). */
export const oidcPayloads = pgTable(
  "oidc_payloads",
  {
    id: text().notNull(),
    model: text().notNull(),
    payload: jsonb().notNull(),
    grantId: text(),
    userCode: text(),
    uid: text(),
    accountId: text(),
    expiresAt: ts(),
    consumedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("oidc_payloads_pk").on(t.model, t.id),
    index().on(t.grantId),
    index().on(t.uid),
    index().on(t.accountId),
    index().on(t.expiresAt),
  ],
);

/** Organization chosen for each grant, so tokens carry org claims. */
export const oidcGrantOrgs = pgTable("oidc_grant_orgs", {
  grantId: text().primaryKey(),
  organizationId: text().notNull(),
  userId: text().notNull(),
  clientId: text().notNull(),
  createdAt: createdAt(),
});

/** ES256 signing keys, private part encrypted. Newest active key signs; retired keys stay published until tokens expire. */
export const signingKeys = pgTable("signing_keys", {
  id: id(),
  kid: text().notNull().unique(),
  alg: text().notNull().default("ES256"),
  publicJwk: jsonb().notNull(),
  privateJwkEnc: text().notNull(),
  status: text({ enum: ["ACTIVE", "RETIRED", "REMOVED"] }).notNull().default("ACTIVE"),
  createdAt: createdAt(),
  retiredAt: ts(),
});
