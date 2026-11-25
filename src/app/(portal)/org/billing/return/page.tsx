import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/http/session";
import { db } from "@/server/db/client";
import { checkoutSessions } from "@/server/db/schema";
import { str, type SP } from "@/components/ui";

export const dynamic = "force-dynamic";

/** After the provider's hosted checkout. The webhook is what records the payment; this page only reports it. */
export default async function Return({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireOrg();
  const sp = await searchParams;
  const [cs] = await db().select().from(checkoutSessions).where(eq(checkoutSessions.id, str(sp.session) ?? ""));
  if (!cs || cs.organizationId !== ctx.organizationId) return <p>Payment not found.</p>;
  const back = cs.returnUrl ? `${cs.returnUrl}${cs.returnUrl.includes("?") ? "&" : "?"}entitlement=refresh` : null;
  return (
    <div className="card max-w-lg">
      {cs.status === "PAID" ? (
        <>
          <h1 className="text-xl font-semibold">Payment received</h1>
          <p className="muted mt-2">Thank you. Your receipt is on its way by email.</p>
          {back ? <a className="btn mt-4" href={back}>Go back to the app</a> : <Link className="btn mt-4" href={`/org/billing/statements/${cs.statementId}`}>View statement</Link>}
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Confirming your payment</h1>
          <p className="muted mt-2">This usually takes a few seconds.</p>
          <meta httpEquiv="refresh" content="3" />
          <Link className="btn-secondary mt-4" href={`/org/billing/statements/${cs.statementId}`}>View statement</Link>
        </>
      )}
    </div>
  );
}
