import { eq } from "drizzle-orm";
import { Messages, type SP } from "@/components/ui";
import { db } from "@/server/db/client";
import { addOns, featureGrants, plans, prices, products, sellerProfiles } from "@/server/db/schema";
import { formatPHP } from "@/lib/money";
import { manilaDate } from "@/lib/time";
import { catalogAction } from "../admin-actions";

export const dynamic = "force-dynamic";

export default async function Catalog({ searchParams }: { searchParams: SP }) {
  const [seller] = await db().select().from(sellerProfiles).where(eq(sellerProfiles.code, "sentire"));
  const ps = await db().select({ plan: plans, product: products }).from(plans).innerJoin(products, eq(products.id, plans.productId)).orderBy(plans.rank);
  const pr = await db().select().from(prices).orderBy(prices.validFrom);
  const ao = await db().select().from(addOns);
  const gr = await db().select().from(featureGrants);
  return (
    <div className="space-y-6">
      <Messages sp={await searchParams} />
      <form action={catalogAction} className="card grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="op" value="seller" />
        <h2 className="font-semibold sm:col-span-2">Seller (Sentire){seller?.confirmed ? "" : " · not confirmed: statements are marked as tests and production refuses to bill"}</h2>
        <input className="input" name="registeredName" defaultValue={seller?.registeredName} placeholder="Registered name" required />
        <input className="input" name="tradeName" defaultValue={seller?.tradeName ?? ""} placeholder="Trade name" />
        <input className="input" name="tin" defaultValue={seller?.tin} placeholder="TIN (9 digits)" required />
        <input className="input" name="branchCode" defaultValue={seller?.branchCode} placeholder="Branch code" />
        <input className="input sm:col-span-2" name="address" defaultValue={seller?.address} placeholder="Registered address" required />
        <select className="input" name="taxStatus" defaultValue={seller?.taxStatus} aria-label="Tax status"><option value="NON_VAT">Non-VAT</option><option value="VAT">VAT-registered</option></select>
        <input className="input" name="bankDetails" defaultValue={seller?.bankDetails ?? ""} placeholder="Bank details for transfers" />
        <label className="text-sm"><input type="checkbox" name="confirmed" defaultChecked={seller?.confirmed} /> These are Sentire&apos;s registered details (BIR Form 2303)</label>
        <div><button className="btn">Save seller</button></div>
      </form>
      <section className="card">
        <h2 className="font-semibold">Plans and prices</h2>
        <table className="data mt-2"><thead><tr><th>Plan</th><th>Limits</th><th>Prices</th></tr></thead><tbody>
          {ps.map(({ plan, product }) => (
            <tr key={plan.id}><td>{product.name} {plan.name}</td><td className="text-xs">{JSON.stringify(plan.limits)}</td>
              <td className="text-xs">{pr.filter((p) => p.planId === plan.id).map((p) => <div key={p.id}>{p.cycle} {formatPHP(p.amountCentavos)} + setup {formatPHP(p.setupFeeCentavos)} from {p.validFrom}{p.validTo ? ` to ${p.validTo}` : ""}</div>)}</td></tr>
          ))}
        </tbody></table>
      </section>
      <section className="card">
        <h2 className="font-semibold">Add-ons and features</h2>
        {ao.map((a) => (
          <div key={a.id} className="mt-2 text-sm">
            <strong>{a.name}</strong> ({a.code}) · {a.onSale ? "on sale" : "not on sale"} · grants {gr.filter((g) => g.addOnId === a.id).map((g) => `${g.featureKey}${g.limit !== null ? ` ${g.limit} ${g.limitMode}` : ""}`).join(", ")}
            · prices {pr.filter((p) => p.addOnId === a.id).map((p) => `${p.cycle} ${formatPHP(p.amountCentavos)} from ${p.validFrom}`).join("; ") || "none"}
            <form action={catalogAction} className="ml-2 inline"><input type="hidden" name="op" value="addon-sale" /><input type="hidden" name="addOnId" value={a.id} /><input type="hidden" name="onSale" value={a.onSale ? "0" : "1"} /><button className="underline">{a.onSale ? "Take off sale" : "Put on sale"}</button></form>
          </div>
        ))}
      </section>
      <form action={catalogAction} className="card grid gap-2 sm:grid-cols-6">
        <input type="hidden" name="op" value="price" />
        <h2 className="font-semibold sm:col-span-6">New price version (current subscriptions keep their price until renewal)</h2>
        <select className="input" name="planId" aria-label="Plan"><option value="">Plan...</option>{ps.map(({ plan, product }) => <option key={plan.id} value={plan.id}>{product.name} {plan.name}</option>)}</select>
        <select className="input" name="addOnId" aria-label="Add-on"><option value="">or add-on...</option>{ao.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="input" name="cycle" aria-label="Cycle"><option value="ANNUAL">Yearly</option><option value="MONTHLY">Monthly</option></select>
        <input className="input" name="amount" placeholder="Price, PHP" required />
        <input className="input" name="setup" placeholder="Setup fee, PHP" />
        <input className="input" type="date" name="validFrom" defaultValue={manilaDate()} aria-label="Valid from" />
        <div><button className="btn">Add price</button></div>
      </form>
    </div>
  );
}
