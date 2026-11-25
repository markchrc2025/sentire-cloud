import Link from "next/link";
import { notFound } from "next/navigation";
import { Messages, type SP } from "@/components/ui";
import { orgDetail } from "@/server/admin/queries";
import { formatPHP } from "@/lib/money";
import { orgAdminAction } from "../../admin-actions";
import { db } from "@/server/db/client";
import { entitlementOverrides } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function OrgAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await orgDetail(id);
  if (!d) notFound();
  const overrides = await db().select().from(entitlementOverrides).where(eq(entitlementOverrides.organizationId, id));
  return (
    <div className="space-y-6">
      <Messages sp={sp} />
      <div className="card"><h1 className="text-xl font-semibold">{d.org.registeredName}</h1><p className="muted text-sm">TIN {d.org.tin}-{d.org.branchCode} · {d.org.vatStatus} · {d.org.address} · {d.org.billingEmail}</p></div>
      <section className="card"><h2 className="font-semibold">Members</h2>
        <table className="data mt-2"><tbody>{d.members.map(({ m, u }) => (
          <tr key={m.id}><td>{u.name}</td><td>{u.email}</td><td>{m.role}</td><td>{m.status}</td><td>{u.platformRole !== "NONE" ? u.platformRole : ""}</td>
            <td><form action={orgAdminAction} className="flex gap-1"><input type="hidden" name="organizationId" value={id} /><input type="hidden" name="op" value="staff" /><input type="hidden" name="userId" value={u.id} />
              <select name="role" defaultValue={u.platformRole} className="input py-0 text-xs" aria-label="Staff role"><option value="NONE">Not staff</option><option value="SUPPORT">Support</option><option value="PLATFORM_ADMIN">Platform Admin</option></select><button className="text-xs underline">Set</button></form></td></tr>
        ))}</tbody></table>
      </section>
      <section className="card"><h2 className="font-semibold">Subscriptions</h2>
        {d.subs.map(({ s, p, prod }) => (
          <div key={s.id} className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span><strong>{prod.name} {p.name}</strong> {s.status} {s.currentPeriodStart ? `${s.currentPeriodStart} to ${s.currentPeriodEnd}` : ""} {s.graceUntil ? `· grace until ${s.graceUntil}` : ""}</span>
            {["PAST_DUE", "SUSPENDED"].includes(s.status) ? (
              <form action={orgAdminAction} className="flex gap-1"><input type="hidden" name="organizationId" value={id} /><input type="hidden" name="op" value="grace" /><input type="hidden" name="subscriptionId" value={s.id} />
                <input type="date" name="until" className="input py-0" required aria-label="Grace until" /><input name="reason" className="input py-0" placeholder="Reason" required /><button className="btn-secondary py-0">Extend grace</button></form>
            ) : null}
          </div>
        ))}
      </section>
      <section className="card"><h2 className="font-semibold">Statements</h2>
        <table className="data mt-2"><tbody>{d.stmts.map((s) => <tr key={s.id}><td><Link className="underline" href={`/admin/statements/${s.id}`}>{s.number}</Link></td><td>{s.kind}</td><td>{s.issueDate}</td><td>{formatPHP(s.totalCentavos)}</td><td>{s.status}</td><td>{s.birInvoiceNumber ?? ""}</td></tr>)}</tbody></table>
      </section>
      <section className="card"><h2 className="font-semibold">Entitlements</h2>
        <table className="data mt-2"><tbody>{d.ents.map((e) => <tr key={e.id}><td>{e.appId}</td><td>{e.state}</td><td>{e.planCode}</td><td>v{e.version}</td><td className="text-xs">{e.features.map((f) => f.key).join(", ")} {Object.entries(e.limits).map(([k, v]) => `${k}=${v.value ?? "unlimited"}(${v.mode})`).join(" ")}</td></tr>)}</tbody></table>
        <h3 className="mt-4 text-sm font-semibold">Overrides</h3>
        <ul className="text-sm">{overrides.map((o) => <li key={o.id}>{o.appId}: {o.forceState ?? ""} {o.features.join(", ")} ({o.reason}){o.expiresAt ? ` until ${o.expiresAt.toISOString().slice(0, 10)}` : ""}
          <form action={orgAdminAction} className="inline"><input type="hidden" name="organizationId" value={id} /><input type="hidden" name="op" value="unoverride" /><input type="hidden" name="id" value={o.id} /><button className="ml-2 underline">Remove</button></form></li>)}</ul>
        <form action={orgAdminAction} className="mt-2 grid gap-2 sm:grid-cols-6">
          <input type="hidden" name="organizationId" value={id} /><input type="hidden" name="op" value="override" />
          <input className="input" name="appId" placeholder="app (ledger)" required /><input className="input" name="features" placeholder="features, comma separated" />
          <select className="input" name="forceState" aria-label="Force state"><option value="">No state change</option><option value="ACTIVE">ACTIVE</option><option value="READ_ONLY">READ_ONLY</option><option value="OFF">OFF</option></select>
          <input className="input" type="date" name="expiresAt" aria-label="Expires" /><input className="input" name="reason" placeholder="Reason" required /><button className="btn-secondary">Add override</button>
        </form>
      </section>
      <section className="card"><h2 className="font-semibold">Event deliveries</h2>
        <table className="data mt-2"><tbody>{d.dels.map((x) => <tr key={x.id}><td>{x.appId}</td><td>{x.status}</td><td>attempt {x.attempt}</td><td className="text-xs">{x.error}</td>
          <td>{x.status === "FAILED" ? <form action={orgAdminAction}><input type="hidden" name="organizationId" value={id} /><input type="hidden" name="op" value="resend" /><input type="hidden" name="id" value={x.id} /><button className="underline">Resend</button></form> : null}</td></tr>)}</tbody></table>
      </section>
      <section className="card"><h2 className="font-semibold">Audit (latest 50)</h2>
        <ul className="mt-2 space-y-1 text-xs">{d.audits.map((a) => <li key={a.id}>{a.at.toISOString().replace("T", " ").slice(0, 19)} · {a.actorKind} · {a.action} · {a.entity}</li>)}</ul>
      </section>
    </div>
  );
}
