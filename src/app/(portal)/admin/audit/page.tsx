import { auditSearch } from "@/server/admin/queries";
import { str, type SP } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Audit({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const rows = await auditSearch({ action: str(sp.action), org: str(sp.org) });
  return (
    <div className="card">
      <form className="mb-3 flex gap-2"><input className="input" name="action" defaultValue={str(sp.action)} placeholder="Action contains" /><input className="input" name="org" defaultValue={str(sp.org)} placeholder="Organization id" /><button className="btn-secondary">Filter</button></form>
      <table className="data"><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Entity</th><th>Organization</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td className="whitespace-nowrap">{a.at.toISOString().replace("T", " ").slice(0, 19)}</td><td>{a.actorKind} {a.actorId?.slice(-6) ?? ""}</td><td>{a.action}</td><td>{a.entity} {a.entityId?.slice(-6) ?? ""}</td><td>{a.organizationId?.slice(-6) ?? ""}</td></tr>)}</tbody></table>
    </div>
  );
}
