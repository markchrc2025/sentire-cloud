import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok", version: pkg.version, time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
