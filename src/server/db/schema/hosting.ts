import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./common";

/** An organization's use of an app (FR-33). Shared = a site in the app's shared deployment. */
export const instances = pgTable(
  "instances",
  {
    id: id(),
    organizationId: text().notNull(),
    appId: text().notNull(),
    baseUrl: text(),
    tenancy: text({ enum: ["SHARED", "DEDICATED"] }).notNull().default("SHARED"),
    status: text({ enum: ["PROVISIONING", "ACTIVE", "READ_ONLY", "FAILED", "EXPORTING", "EXPORTED", "DELETED"] }).notNull().default("PROVISIONING"),
    region: text(),
    serverId: text(),
    exportFileUrl: text(),
    exportSha256: text(),
    exportReadyAt: ts(),
    exportExpiresAt: ts(),
    deletionCertificateKey: text(),
    deletedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.appId), index().on(t.status)],
);

export const provisioningJobs = pgTable(
  "provisioning_jobs",
  {
    id: id(),
    instanceId: text().notNull(),
    organizationId: text().notNull(),
    kind: text({ enum: ["PROVISION", "EXPORT", "DELETE", "SUSPEND", "RESUME"] }).notNull(),
    status: text({ enum: ["QUEUED", "RUNNING", "WAITING", "DONE", "FAILED"] }).notNull().default("QUEUED"),
    attempt: integer().notNull().default(0),
    nextAttemptAt: ts(),
    log: text().notNull().default(""),
    result: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status, t.nextAttemptAt), index().on(t.instanceId)],
);
