import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "./common";

export const healthChecks = pgTable(
  "health_checks",
  {
    id: id(),
    serviceId: text().notNull(),
    up: boolean().notNull(),
    slow: boolean().notNull().default(false),
    httpStatus: integer().notNull().default(0),
    ms: integer().notNull(),
    error: text(),
    at: createdAt(),
  },
  (t) => [index().on(t.serviceId, t.at)],
);

export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    serviceId: text().notNull(),
    title: text().notNull(),
    status: text({ enum: ["OPEN", "MONITORING", "RESOLVED"] }).notNull().default("OPEN"),
    note: text(),
    startedAt: createdAt(),
    resolvedAt: ts(),
  },
  (t) => [index().on(t.serviceId, t.status)],
);
