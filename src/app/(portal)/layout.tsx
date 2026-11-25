import Link from "next/link";
import { Brand } from "@/components/Brand";
import { currentSession } from "@/server/http/session";
import { myOrganizations } from "@/server/account/orgs";
import { signOutAction } from "../(auth)/actions";
import { switchOrgAction } from "./portal-actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await currentSession();
  const orgs = s ? await myOrganizations(s.user.id) : [];
  const current = orgs.find((o) => o.org.id === s?.session.currentOrganizationId) ?? orgs[0];
  const isStaff = s && s.user.platformRole !== "NONE";
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Brand href="/org" />
            {s ? (
              <nav className="flex gap-4 text-sm">
                <Link href="/org">Apps</Link>
                <Link href="/org/members">Members</Link>
                <Link href="/org/billing">Billing</Link>
                <Link href="/org/settings">Organization</Link>
                {isStaff ? <Link href="/admin">Admin</Link> : null}
              </nav>
            ) : null}
          </div>
          {s ? (
            <div className="flex items-center gap-3 text-sm">
              {orgs.length > 1 ? (
                <form action={switchOrgAction} className="flex items-center gap-2">
                  <select name="organizationId" defaultValue={current?.org.id} className="input py-1" aria-label="Organization">
                    {orgs.map((o) => (
                      <option key={o.org.id} value={o.org.id}>{o.org.tradeName ?? o.org.registeredName}</option>
                    ))}
                  </select>
                  <button className="btn-secondary py-1">Switch</button>
                </form>
              ) : current ? (
                <span className="muted">{current.org.tradeName ?? current.org.registeredName}</span>
              ) : null}
              <Link href="/account">{s.user.name}</Link>
              <form action={signOutAction}><button className="underline">Sign out</button></form>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
