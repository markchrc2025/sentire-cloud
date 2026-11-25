import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { catalogFor } from "@/server/billing/catalog";
import { formatPHP } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function Pricing({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const cat = await catalogFor(product);
  if (!cat) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Brand />
      <h1 className="mt-8 text-3xl font-semibold">{cat.product.name} plans</h1>
      <p className="muted mt-2">Billed yearly. A one-time setup fee covers onboarding and data migration.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        {cat.plans.filter((p) => p.annual).map((p) => (
          <div key={p.plan.id} className="card flex flex-col">
            <h2 className="text-lg font-semibold">{p.plan.name}</h2>
            <p className="mt-2 text-2xl font-semibold">{formatPHP(Math.round(p.annual!.amountCentavos / 12))}<span className="muted text-sm font-normal"> a month</span></p>
            <p className="muted text-xs">{formatPHP(p.annual!.amountCentavos)} a year, plus {formatPHP(p.annual!.setupFeeCentavos)} setup</p>
            <p className="mt-3 flex-1 text-sm">{p.plan.summary}</p>
            <Link className="btn mt-4" href={`/sign-up?next=${encodeURIComponent(`/org/billing/subscribe?product=${cat.product.code}&plan=${p.plan.code}`)}`}>Choose {p.plan.name}</Link>
          </div>
        ))}
      </div>
    </main>
  );
}
