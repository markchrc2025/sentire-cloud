import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";

/** Append-only (trigger audit_entries_append_only). */
export const auditEntries = pgTable(
  "audit_entries",
  {
    id: id(),
    organizationId: text(),
    actorId: text(),
    actorKind: text().notNull().default("user"), // user | staff | system | app
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    ipAddress: text(),
    at: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.at), index().on(t.entity, t.entityId)],
);
