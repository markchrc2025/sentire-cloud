import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

const g = globalThis as unknown as { __sentireBoss?: PgBoss; __sentireBossStarted?: Promise<PgBoss> };

/** pg-boss on the same Postgres, in its own schema. */
export function boss(): Promise<PgBoss> {
  if (!g.__sentireBossStarted) {
    g.__sentireBoss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
    g.__sentireBoss.on("error", (e) => console.error("pg-boss", e));
    g.__sentireBossStarted = g.__sentireBoss.start().then(() => g.__sentireBoss!);
  }
  return g.__sentireBossStarted;
}

/** Enqueue a job. `singletonKey` makes it idempotent. */
export async function enqueue(name: string, data: object, opts: { singletonKey?: string; startAfter?: Date | number } = {}) {
  const b = await boss();
  await b.createQueue(name);
  return b.send(name, data, opts);
}
