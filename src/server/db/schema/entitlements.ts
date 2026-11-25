import { bigint, date, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./common";

export interface EntLimit {
  value: number | null; // null = unlimited
  mode: "SOFT" | "HARD" | "OVERAGE";
}
export interface EntFeature {
  key: string;
  source: "PLAN" | "ADD_ON" | "TRIAL" | "OVERRIDE";
  limit?: number | null;
  mode?: "SOFT" | "HARD" | "OVERAGE";
}

/** Derived per organization and app (FR-24). Never typed in; recomputed on every change and versioned. */
export const entitlements = pgTable(
  "entitlements",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text().notNull(),
    state: text({ enum: ["ACTIVE", "READ_ONLY", "OFF"] }).notNull(),
    planCode: text(),
    addOns: jsonb().$type<string[]>().notNull().default([]),
    limits: jsonb().$type<Record<string, EntLimit>>().notNull().default({}),
    features: jsonb().$type<EntFeature[]>().notNull().default([]),
    subscriptionId: text(),
    periodEnd: date(),
    version: integer().notNull().default(1),
    computedAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.appId)],
);

/** Staff overrides (audited), optionally time-limited. */
export const entitlementOverrides = pgTable(
  "entitlement_overrides",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text().notNull(),
    features: jsonb().$type<string[]>().notNull().default([]),
    limits: jsonb().$type<Record<string, EntLimit>>().notNull().default({}),
    forceState: text({ enum: ["ACTIVE", "READ_ONLY", "OFF"] }),
    reason: text().notNull(),
    expiresAt: ts(),
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.appId)],
);

/** Usage reported by apps (FR-26, FR-21). Counts are a daily snapshot; metered items are summed. */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text().notNull(),
    meter: text().notNull(),
    quantity: bigint({ mode: "number" }).notNull(),
    periodDate: date().notNull(),
    idempotencyKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.appId, t.idempotencyKey), index().on(t.organizationId, t.appId, t.meter, t.periodDate)],
);

/** Paywall (FR-48). */
export const upgradeRequests = pgTable(
  "upgrade_requests",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text(),
    featureKey: text().notNull(),
    requesterId: text().notNull(),
    note: text(),
    status: text({ enum: ["OPEN", "APPROVED", "DECLINED", "EXPIRED"] }).notNull().default("OPEN"),
    decidedBy: text(),
    reason: text(),
    decidedAt: ts(),
    returnUrl: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId, t.status)],
);

/** Paywall figures (FR-51). */
export const paywallEvents = pgTable(
  "paywall_events",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text(),
    featureKey: text().notNull(),
    userId: text(),
    action: text({ enum: ["SHOWN", "UPGRADE_CLICKED", "REQUESTED", "PURCHASED"] }).notNull(),
    at: createdAt(),
  },
  (t) => [index().on(t.featureKey, t.action)],
);

/** Outgoing event deliveries to app endpoints (FR-29, used for account events from Phase 3). */
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    eventId: text().notNull(),
    appId: text().notNull(),
    organizationId: text(),
    attempt: integer().notNull().default(0),
    status: text({ enum: ["PENDING", "DELIVERED", "RETRYING", "FAILED", "NOT_DELIVERED"] }).notNull().default("PENDING"),
    httpStatus: integer(),
    error: text(),
    nextAttemptAt: ts(),
    deliveredAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.eventId, t.appId), index().on(t.status, t.nextAttemptAt), index().on(t.organizationId)],
);

