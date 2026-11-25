import Link from "next/link";
import { Messages, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { orgStatements, orgSubscriptions } from "@/server/billing/subscriptions";
import { orgWithholdings } from "@/server/billing/withholding";
import { catalogFor } from "@/server/billing/catalog";
import { formatPHP } from "@/lib/money";
import { balance } from "@/server/billing/statements";
import { addOnsAction, cancelAction, changePlanAction, uploadCertificateAction } from "./billing-actions";
import { billingPageExtras } from "@/server/billing/page-extras";

export const metadata = { title: "Billing" };
const STATUS: Record<string, string> = { PENDING: "Waiting for payment", ACTIVE: "Active", PAST_DUE: "Payment overdue", SUSPENDED: "Read-only (unpaid)", CANCELLED: "Cancelled", EXPIRED: "Not started" };

export default async function Billing({ searchParams }: { searchParams: SP }) {
  const { ctx, current } = await requireOrg();
  const sp = await searchParams;
  const canPay = current.role === "OWNER" || current.role === "BILLING";
  const canSee = canPay || current.role === "ADMIN";
  if (!canSee) {
    return <p className="muted">Billing is managed by your organization&apos;s Owner and Billing Contact.</p>;
  }
  const [subs, statements, whs] = await Promise.all([orgSubscriptions(ctx), orgStatements(ctx), orgWithholdings(ctx)]);
  const extras = await billingPageExtras(ctx.organizationId);
  return (
    <>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <div className="mt-4"><Messages sp={sp} /></div>
      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Subscriptions</h2>
          {canPay ? <Link className="btn-secondary" href="/org/billing/subscribe?product=ledger">Subscribe to Sentire Ledger</Link> : null}
        </div>
        {subs.length === 0 ? <p className="muted mt-3 text-sm">No subscriptions yet.</p> : null}
        <div className="mt-3 space-y-4">
          {await Promise.all(subs.map(async ({ sub, plan, product }) => {
            const cat = await catalogFor(product.code);
            return (
              <div key={sub.id} className="rounded-s ring-1 ring-ink/10 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><strong>{product.name} {plan.name}</strong> <span className="muted text-sm">({sub.cycle === "ANNUAL" ? "yearly" : "monthly"})</span></div>
                  <span className="badge bg-surface-muted">{STATUS[sub.status]}{sub.cancelAtPeriodEnd ? ", ends at period end" : ""}</span>
                </div>
                {sub.currentPeriodStart ? <p className="muted mt-1 text-sm">Paid period {sub.currentPeriodStart} to {sub.currentPeriodEnd}. {sub.cancelAtPeriodEnd ? "It will not renew." : `Renews on ${sub.currentPeriodEnd}.`}</p> : null}
                {sub.scheduledPlanId ? <p className="mt-1 text-sm">Changes to {cat?.plans.find((p) => p.plan.id === sub.scheduledPlanId)?.plan.name} on {sub.currentPeriodEnd}.</p> : null}
                {extras.usage[sub.id] ? <div className="mt-2 text-sm">{extras.usage[sub.id]}</div> : null}
                {canPay && sub.status === "ACTIVE" && cat ? (
                  <div className="mt-3 flex flex-wrap gap-4">
                    <form action={changePlanAction} className="flex items-center gap-2">
                      <input type="hidden" name="subscriptionId" value={sub.id} />
                      <select name="planId" className="input py-1" defaultValue={plan.id} aria-label="Plan">
                        {cat.plans.map((p) => <option key={p.plan.id} value={p.plan.id}>{p.plan.name}{p.annual ? `, ${formatPHP(p.annual.amountCentavos)} a year` : ""}</option>)}
                      </select>
                      <button className="btn-secondary py-1">Change plan</button>
                    </form>
                    {cat.addOns.length ? (
                      <form action={addOnsAction} className="flex items-center gap-2">
                        <input type="hidden" name="subscriptionId" value={sub.id} />
                        {cat.addOns.map((a) => <label key={a.id} className="text-sm"><input type="checkbox" name="addOns" value={a.id} defaultChecked={extras.addOns[sub.id]?.includes(a.id)} /> {a.name}</label>)}
                        <button className="btn-secondary py-1">Save add-ons</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
                {current.role === "OWNER" && ["ACTIVE", "PAST_DUE", "SUSPENDED"].includes(sub.status) ? (
                  <form action={cancelAction} className="mt-3">
                    <input type="hidden" name="subscriptionId" value={sub.id} />
                    <input type="hidden" name="cancel" value={sub.cancelAtPeriodEnd ? "0" : "1"} />
                    <button className={sub.cancelAtPeriodEnd ? "btn-secondary" : "text-sm text-red-700 underline"}>{sub.cancelAtPeriodEnd ? "Keep my subscription" : "Cancel at the end of the paid period"}</button>
                  </form>
                ) : null}
              </div>
            );
          }))}
        </div>
      </section>

      <section className="card mt-6 overflow-x-auto">
        <h2 className="font-semibold">Billing statements</h2>
        <table className="data mt-3">
          <thead><tr><th>Number</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th>BIR invoice</th></tr></thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id}>
                <td><Link className="underline" href={`/org/billing/statements/${s.id}`}>{s.number}</Link></td>
                <td>{s.issueDate}</td><td>{s.dueDate}</td><td>{formatPHP(s.totalCentavos)}</td>
                <td>{s.status === "VOID" ? "n/a" : formatPHP(Math.max(0, balance(s)))}</td>
                <td>{s.status.replace("_", " ").toLowerCase()}</td>
                <td>{s.birInvoiceNumber ?? (s.status === "PAID" ? "Being issued" : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {statements.length === 0 ? <p className="muted text-sm">No statements yet.</p> : null}
      </section>

      {whs.length ? (
        <section className="card mt-6">
          <h2 className="font-semibold">Withholding certificates (BIR Form 2307)</h2>
          <table className="data mt-3">
            <thead><tr><th>Statement</th><th>ATC</th><th>Amount</th><th>Quarter</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {whs.map(({ w, number }) => (
                <tr key={w.id}>
                  <td>{number}</td><td>{w.atc}</td><td>{formatPHP(w.amountCentavos)}</td><td>{w.quarter}</td>
                  <td>{w.status === "PENDING" ? (w.certificateKey ? "Uploaded, being checked" : "Certificate needed") : w.status === "REJECTED" ? `Rejected: ${w.reason}` : w.status.toLowerCase()}</td>
                  <td>
                    {canPay && (w.status === "REJECTED" || (w.status === "PENDING" && !w.certificateKey)) ? (
                      <form action={uploadCertificateAction} className="flex items-center gap-2">
                        <input type="hidden" name="withholdingId" value={w.id} />
                        <input type="file" name="file" accept="application/pdf,image/png,image/jpeg" className="text-xs" required />
                        <button className="btn-secondary py-1">Upload</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
