import postgres from "postgres";
import { execSync } from "node:child_process";

/** Fresh test database for every run, migrated the same way production boots. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/sentire_cloud_test";
  const sql = postgres(url, { onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`drop schema if exists pgboss cascade`;
  await sql`create schema public`;
  await sql.end();
  execSync("pnpm -s tsx src/server/db/migrate-cli.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
