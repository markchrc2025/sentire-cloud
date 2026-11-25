import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { outboundEmails } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/** Staging only: emails that were logged instead of sent, for UAT. Never available in production. */
export default async function Outbox() {
  if (process.env.SENTIRE_ENV !== "staging" && process.env.NODE_ENV === "production") notFound();
  const rows = await db().select().from(outboundEmails).orderBy(desc(outboundEmails.createdAt)).limit(50);
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-xl font-semibold">Staging outbox</h1>
      <p className="muted text-sm">Last 50 emails. This page does not exist in production.</p>
      <ul className="mt-4 space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="card text-sm">
            <div className="font-medium">{r.subject}</div>
            <div className="muted text-xs">To {r.to} · {r.status} · {r.createdAt.toISOString()}</div>
            <pre className="mt-2 whitespace-pre-wrap">{r.text}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
