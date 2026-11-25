import { text, timestamp } from "drizzle-orm/pg-core";
import { newId } from "@/lib/ids";

export const id = () => text().primaryKey().$defaultFn(newId);
export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = () => timestamp({ withTimezone: true });
