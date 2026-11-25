import Link from "next/link";
import { requireStaff } from "@/server/admin/staff";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4 border-b border-ink/10 pb-3 text-sm">
        <strong>Sentire staff</strong>
        <Link href="/admin">Overview</Link>
        <Link href="/admin/orgs">Organizations</Link>
        <Link href="/admin/withholdings">2307 queue</Link>
        <Link href="/admin/catalog">Catalog</Link>
        <Link href="/admin/apps">Apps</Link>
        <Link href="/admin/paywall">Paywall</Link>
        <Link href="/admin/audit">Audit log</Link>
        <Link href="/status">Status</Link>
        <span className="muted ml-auto">{s.user.platformRole === "SUPPORT" ? "Support (read-only)" : "Platform Admin"} · every action is logged</span>
      </div>
      {children}
    </div>
  );
}
