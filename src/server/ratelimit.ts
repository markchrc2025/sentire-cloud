import { sql } from "drizzle-orm";
import { db } from "./db/client";

/** Fixed window counter in Postgres. Returns false when the limit is exceeded. */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await db().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  return (Array.from(rows)[0]?.count ?? 1) <= limit;
}

export class RateLimitedError extends Error {
  constructor() {
    super("Too many attempts. Please wait a few minutes and try again.");
  }
}

export async function limit(key: string, max: number, windowSeconds: number) {
  if (!(await hit(key, max, windowSeconds))) throw new RateLimitedError();
}
