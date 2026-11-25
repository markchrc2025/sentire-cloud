import Link from "next/link";
import { notFound } from "next/navigation";
import { Messages, type SP } from "@/components/ui";
import { statementDetail } from "@/server/admin/queries";
import { ATCS } from "@/server/billing/payments";
import { formatPHP } from "@/lib/money";
import { stmtAction } from "../../admin-actions";

export const dynamic = "force-dynamic";

function F({ op, id, children, label }: { op: string; id: string; children: React.ReactNode; label: string }) {
  return (
    <form action={stmtAction} className="card space-y-2">
      <h3 className="font-semibold">{label}</h3>
      <input type="hidden" name="op" value={op} /><input type="hidden" name="statementId" value={id} />
      {children}
    </form>
  );
}

export default async function StatementAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const d = await statementDetail(id);
  if (!d) notFound();
  const { st, pays } = d;
  return (
    <div className="space-y-4">
      <Messages sp={await searchParams} />
      <div className="card">
        <Link className="muted text-sm underline" href={`/admin/orgs/${st.organizationId}`}>Organization</Link>
        <h1 className="text-xl font-semibold">{st.number} · {st.status}</h1>
        <p className="text-sm">Total {formatPHP(st.totalCentavos)} · paid {formatPHP(st.paidCentavos)} · withheld {formatPHP(st.withheldCentavos)} · credited {formatPHP(st.creditedCentavos)} · invoice {st.birInvoiceNumber ?? "none"}</p>
        <ul className="mt-2 text-xs">{pays.map((p) => <li key={p.id}>{p.paidAt.toISOString().slice(0, 10)} {p.kind} {p.method} {formatPHP(p.amountCentavos)} {p.reference ?? p.providerRef ?? ""}</li>)}</ul>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <F op="bank" id={id} label="Record bank transfer"><input className="input" name="amount" placeholder="Amount received, e.g. 18,330.40" required /><input className="input" name="reference" placeholder="Bank reference" required />
          <select className="input" name="atc" aria-label="Withholding"><option value="">No withholding</option>{Object.entries(ATCS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select><button className="btn">Record</button></F>
        <F op="invoice" id={id} label="BIR invoice number"><input className="input" name="invoice" placeholder="Invoice number from Sentire's registered system" required /><button className="btn">Save</button></F>
        <F op="credit" id={id} label="Credit note"><input className="input" name="amount" placeholder="Amount" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary">Issue</button></F>
        <F op="refund" id={id} label="Record refund"><input className="input" name="amount" placeholder="Amount" required /><input className="input" name="reference" placeholder="Refund reference" required /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary">Record</button></F>
        <F op="void" id={id} label="Void (unpaid only)"><input className="input" name="reason" placeholder="Reason" required /><button className="btn-danger">Void</button></F>
      </div>
    </div>
  );
}
