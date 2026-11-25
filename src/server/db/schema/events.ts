import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";

/** Every sentire.event.v1 event Sentire Cloud publishes or receives (FR-29, FR-32). Delivery records come with the hub. */
export const events = pgTable(
  "events",
  {
    id: id(),
    eventId: text().notNull(),
    type: text().notNull(),
    source: text().notNull(),
    organizationId: text(),
    data: jsonb().notNull(),
    direction: text({ enum: ["OUT", "IN"] }).notNull().default("OUT"),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.eventId), index().on(t.organizationId, t.receivedAt), index().on(t.type)],
);
