import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/** Truncate every app table (keeps migrations). Append-only triggers fire on DELETE, not TRUNCATE. */
export async function resetDb() {
  const rows = await db().execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'signing_keys'`);
  const names = Array.from(rows).map((r) => `"${r.tablename}"`);
  if (names.length) await db().execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
}

/** Postgres error message behind a Drizzle query error. */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { cause?: { message?: string }; message: string };
    return err.cause?.message ?? err.message;
  }
  throw new Error("expected the query to fail");
}
