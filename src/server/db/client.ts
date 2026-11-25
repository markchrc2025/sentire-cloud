import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DBorTx = DB | Tx;

const g = globalThis as unknown as { __sentireSql?: ReturnType<typeof postgres>; __sentireDb?: DB };

export function sql() {
  if (!g.__sentireSql) {
    g.__sentireSql = postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  }
  return g.__sentireSql;
}

export function db(): DB {
  if (!g.__sentireDb) g.__sentireDb = drizzle(sql(), { schema, casing: "snake_case" });
  return g.__sentireDb;
}

export async function closeDb() {
  await g.__sentireSql?.end({ timeout: 5 });
  g.__sentireSql = undefined;
  g.__sentireDb = undefined;
}
