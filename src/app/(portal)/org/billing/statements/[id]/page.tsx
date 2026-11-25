import Link from "next/link";
import { notFound } from "next/navigation";
import { Messages, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { statementWithLines, balance } from "@/server/billing/statements";
import { ATCS } from "@/server/billing/payments";
import { formatPHP } from "@/lib/money";
import { payAction } from "../../billing-actions";

export const metadata = { title: "Billing statement" };

export default async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, current } = await requireOrg();
  if (!["OWNER", "ADMIN", "BILLING"].includes(current.role)) notFound();
  const found = await statementWithLines(ctx.organizationId, id);
  if (!found) notFound();
  const { st, lines } = found;
  const due = balance(st);
  const canPay = (current.role === "OWNER" || current.role === "BILLING") && ["OPEN", "PARTIALLY_PAID"].includes(st.status) && due > 0;
  return (
    <div className="max-w-3xl">
      <Link className="muted text-sm underline" href="/org/billing">Billing</Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Billing statement {st.number}</h1>
        <a className="btn-secondary" href={`/org/billing/statements/${st.id}/pdf`}>Download PDF</a>
      </div>
      <div className="mt-4"><Messages sp={sp} /></div>
      <div className="card">
        <p className="muted text-sm">Issued {st.issueDate} · Due {st.dueDate} · {st.status.replace("_", " ").toLowerCase()}</p>
        <table className="data mt-3">
          <thead><tr><th>Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="text-right">{formatPHP(l.amountCentavos)}</td></tr>)}</tbody>
        </table>
        <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
          {st.taxCentavos ? <div className="flex justify-between"><span>VAT included</span><span>{formatPHP(st.taxCentavos)}</span></div> : null}
          <div className="flex justify-between font-semibold"><span>Total</span><span>{formatPHP(st.totalCentavos)}</span></div>
          {st.paidCentavos ? <div className="flex justify-between"><span>Paid</span><span>-{formatPHP(st.paidCentavos)}</span></div> : null}
          {st.withheldCentavos ? <div className="flex justify-between"><span>Withheld (2307)</span><span>-{formatPHP(st.withheldCentavos)}</span></div> : null}
          {st.creditedCentavos ? <div className="flex justify-between"><span>Credited</span><span>-{formatPHP(st.creditedCentavos)}</span></div> : null}
          <div className="flex justify-between font-semibold"><span>Balance</span><span>{formatPHP(Math.max(0, due))}</span></div>
        </div>
        <p className="muted mt-4 text-xs">This is a billing statement, not a BIR invoice. {st.birInvoiceNumber ? `BIR invoice: ${st.birInvoiceNumber}.` : "Sentire issues the invoice when payment is received."}</p>
      </div>
      {canPay ? (
        <form action={payAction} className="card mt-6 space-y-3">
          <input type="hidden" name="statementId" value={st.id} />
          <h2 className="font-semibold">Pay {formatPHP(due)}</h2>
          {st.paidCentavos === 0 ? (
            <div>
              <label className="label" htmlFor="atc">Does your company withhold tax on this payment?</label>
              <select id="atc" name="atc" className="input" defaultValue="">
                <option value="">No, pay the full amount</option>
                {Object.entries(ATCS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <p className="muted mt-1 text-xs">If you withhold, you pay the net amount now and upload BIR Form 2307 for the quarter on the billing page.</p>
            </div>
          ) : null}
          <button className="btn">Pay with card, GCash or Maya</button>
        </form>
      ) : null}
    </div>
  );
}
