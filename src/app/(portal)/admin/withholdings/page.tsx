import { Messages, str, type SP } from "@/components/ui";
import { withholdingQueue } from "@/server/admin/queries";
import { quarterlyReport } from "@/server/billing/withholding";
import { formatPHP } from "@/lib/money";
import { quarterOf } from "@/server/billing/payments";
import { manilaDate } from "@/lib/time";
import { whtAction } from "../admin-actions";

export const dynamic = "force-dynamic";

export default async function Wht({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = str(sp.quarter) ?? quarterOf(manilaDate());
  const [queue, report] = await Promise.all([withholdingQueue(), quarterlyReport(q)]);
  return (
    <div className="space-y-6">
      <Messages sp={sp} />
      <section className="card"><h2 className="font-semibold">Certificates to check</h2>
        <table className="data mt-2"><tbody>{queue.map(({ w, org, number }) => (
          <tr key={w.id}><td>{org.registeredName}<div className="muted text-xs">TIN {org.tin}</div></td><td>{number}</td><td>{w.atc}</td><td>{formatPHP(w.amountCentavos)}</td><td>{w.quarter}</td>
            <td>{w.certificateKey ? <a className="underline" href={`/admin/withholdings/${w.id}/file`}>{w.certificateName}</a> : "not uploaded"}</td>
            <td>{w.certificateKey && w.status === "PENDING" ? (
              <div className="flex gap-2">
                <form action={whtAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="accept" value="1" /><button className="btn py-1">Accept</button></form>
                <form action={whtAction} className="flex gap-1"><input type="hidden" name="id" value={w.id} /><input className="input py-1" name="reason" placeholder="Reason" required /><button className="btn-secondary py-1">Reject</button></form>
              </div>) : w.status}</td></tr>
        ))}</tbody></table>
      </section>
      <section className="card"><h2 className="font-semibold">Quarterly report {q}</h2>
        <form className="my-2"><input className="input max-w-40" name="quarter" defaultValue={q} aria-label="Quarter" /> <button className="btn-secondary">Show</button></form>
        <table className="data"><thead><tr><th>Payor</th><th>TIN</th><th>Statement</th><th>ATC</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{report.map(({ w, org, number }) => <tr key={w.id}><td>{org.registeredName}</td><td>{org.tin}-{org.branchCode}</td><td>{number}</td><td>{w.atc}</td><td>{formatPHP(w.amountCentavos)}</td><td>{w.status}</td></tr>)}</tbody></table>
        <p className="muted mt-2 text-sm">Total withheld: {formatPHP(report.reduce((s, r) => s + r.w.amountCentavos, 0))}; received {formatPHP(report.filter((r) => r.w.status === "RECEIVED").reduce((s, r) => s + r.w.amountCentavos, 0))}.</p>
      </section>
    </div>
  );
}
