import { Messages, str, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { catalogFor } from "@/server/billing/catalog";
import { formatPHP } from "@/lib/money";
import { subscribeAction } from "../billing-actions";

export const metadata = { title: "Subscribe" };

export default async function Subscribe({ searchParams }: { searchParams: SP }) {
  const { current } = await requireOrg();
  const sp = await searchParams;
  const cat = await catalogFor(str(sp.product) ?? "ledger");
  if (!cat) return <p>Product not found.</p>;
  if (!(current.role === "OWNER" || current.role === "BILLING")) return <p className="muted">Only the Owner or the Billing Contact can subscribe.</p>;
  const chosen = str(sp.plan);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Subscribe to {cat.product.name}</h1>
      <p className="muted mt-1">For {current.org.registeredName}. Prices are per year, paid yearly.</p>
      <div className="mt-4"><Messages sp={sp} /></div>
      <form action={subscribeAction} className="card mt-2 space-y-5">
        <input type="hidden" name="product" value={cat.product.code} />
        <input type="hidden" name="cycle" value="ANNUAL" />
        <fieldset>
          <legend className="label">Plan</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {cat.plans.filter((p) => p.annual).map((p, i) => (
              <label key={p.plan.id} className="flex gap-3 rounded-s p-3 ring-1 ring-ink/15 has-[:checked]:ring-2 has-[:checked]:ring-ink">
                <input type="radio" name="planId" value={p.plan.id} defaultChecked={chosen ? chosen === p.plan.code : i === 1} required />
                <span>
                  <strong>{p.plan.name}</strong> {formatPHP(p.annual!.amountCentavos)} a year
                  <span className="muted block text-xs">{formatPHP(Math.round(p.annual!.amountCentavos / 12))} a month equivalent, plus {formatPHP(p.annual!.setupFeeCentavos)} setup once</span>
                  <span className="muted block text-xs">{p.plan.summary}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {cat.addOns.length ? (
          <fieldset>
            <legend className="label">Add-ons</legend>
            {cat.addOns.map((a) => <label key={a.id} className="block text-sm"><input type="checkbox" name="addOns" value={a.id} /> {a.name}: {a.benefit}</label>)}
          </fieldset>
        ) : null}
        <fieldset>
          <legend className="label">How will you pay?</legend>
          <label className="block text-sm"><input type="radio" name="method" value="ONLINE" defaultChecked /> Card, GCash or Maya now</label>
          <label className="block text-sm"><input type="radio" name="method" value="BANK_TRANSFER" /> Bank transfer within 7 days</label>
        </fieldset>
        <p className="muted text-xs">You get a billing statement now. Sentire issues the BIR invoice when the payment is received. If your company withholds tax, you can pay net of withholding on the next page.</p>
        <button className="btn">Continue</button>
      </form>
    </div>
  );
}
