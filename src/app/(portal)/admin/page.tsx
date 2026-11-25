import Link from "next/link";
import { dashboard } from "@/server/admin/queries";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

export default async function Admin() {
  const c = await dashboard();
  const tiles = [
    ["Organizations", c.orgs, "/admin/orgs"], ["Active subscriptions", c.active, "/admin/orgs"], ["Past due", c.past_due, "/admin/orgs"], ["Read-only (suspended)", c.suspended, "/admin/orgs"],
    ["Open statements", c.open_stmt, "/admin/orgs"], ["2307s to check", c.wht, "/admin/withholdings"], ["Failed event deliveries", c.failed, "/admin/orgs"], ["Open incidents", c.incidents, "/status"],
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map(([label, n, href]) => (
        <Link key={label} href={href} className="card block"><div className="muted text-sm">{label}</div><div className="mt-1 text-2xl font-semibold">{n}</div></Link>
      ))}
    </div>
  );
}
