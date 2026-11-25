import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client";

/** Applied on boot (web and worker) and by tests. Safe to run concurrently: drizzle takes a lock per run. */
export async function runMigrations() {
  await migrate(db(), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
}
