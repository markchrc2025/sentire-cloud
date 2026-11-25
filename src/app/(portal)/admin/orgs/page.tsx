import Link from "next/link";
import { searchOrgs } from "@/server/admin/queries";
import { str, type SP } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Orgs({ searchParams }: { searchParams: SP }) {
  const q = str((await searchParams).q) ?? "";
  const rows = await searchOrgs(q);
  return (
    <div className="card">
      <form className="mb-4 flex gap-2"><input className="input" name="q" defaultValue={q} placeholder="Name, TIN or billing email" aria-label="Search" /><button className="btn-secondary">Search</button></form>
      <table className="data">
        <thead><tr><th>Organization</th><th>TIN</th><th>Billing email</th><th>Since</th></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.id}><td><Link className="underline" href={`/admin/orgs/${o.id}`}>{o.registeredName}</Link>{o.flaggedDuplicateTin ? <span className="badge ml-2 bg-gold/30">duplicate TIN</span> : null}</td><td>{o.tin}-{o.branchCode}</td><td>{o.billingEmail}</td><td>{o.createdAt.toISOString().slice(0, 10)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
