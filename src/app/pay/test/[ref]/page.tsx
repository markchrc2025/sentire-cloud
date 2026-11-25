import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { checkoutSessions } from "@/server/db/schema";
import { formatPHP } from "@/lib/money";
import { testPayAction } from "./test-pay-action";

export const dynamic = "force-dynamic";

/** Hosted page of the built-in test provider (staging only). Looks like a provider checkout; no real money moves. */
export default async function TestPay({ params }: { params: Promise<{ ref: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.SENTIRE_ENV !== "staging") notFound();
  const { ref } = await params;
  const [cs] = await db().select().from(checkoutSessions).where(and(eq(checkoutSessions.provider, "test"), eq(checkoutSessions.providerRef, ref)));
  if (!cs) notFound();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="card">
        <p className="badge bg-gold/30">Test payment page (staging)</p>
        <h1 className="mt-3 text-xl font-semibold">Pay {formatPHP(cs.amountCentavos)}</h1>
        <p className="muted mt-1 text-sm">No real money moves. Choose what the payment provider would report.</p>
        {cs.status !== "PENDING" ? <p className="mt-4">This payment is already {cs.status.toLowerCase()}.</p> : (
          <form action={testPayAction} className="mt-5 flex flex-wrap gap-3">
            <input type="hidden" name="ref" value={ref} />
            <button name="outcome" value="paid:GCASH" className="btn">Pay with GCash</button>
            <button name="outcome" value="paid:CARD" className="btn-secondary">Pay with card</button>
            <button name="outcome" value="failed" className="btn-danger">Make it fail</button>
          </form>
        )}
      </div>
    </main>
  );
}
