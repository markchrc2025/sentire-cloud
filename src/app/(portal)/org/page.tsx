import { Messages, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { allowedApps } from "@/server/account/orgs";
import { listApps } from "@/server/account/registry";
import { launcherExtras } from "@/server/account/launcher";

export const metadata = { title: "Your apps" };

export default async function OrgHome({ searchParams }: { searchParams: SP }) {
  const { s, current } = await requireOrg();
  const sp = await searchParams;
  const allowed = await allowedApps(s.user.id, current.org.id);
  const apps = (await listApps()).filter((a) => a.active);
  const extras = await launcherExtras(current.org.id);
  return (
    <>
      <Messages sp={sp} />
      <h1 className="text-2xl font-semibold">{current.org.tradeName ?? current.org.registeredName}</h1>
      <p className="muted mt-1">You are {current.role === "OWNER" ? "an Owner" : current.role === "ADMIN" ? "an Admin" : current.role === "BILLING" ? "the Billing Contact" : "a Member"} of this organization.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((a) => {
          const ok = allowed.includes(a.appId);
          const state = extras[a.appId];
          return (
            <div key={a.appId} className={`card ${ok ? "" : "opacity-60"}`}>
              <h2 className="font-semibold">{a.name}</h2>
              <p className="muted mt-1 text-sm">{state?.label ?? (ok ? "You have access." : "You don't have access.")}</p>
              {ok && state?.open !== false ? (
                <a className="btn mt-4" href={state?.url ?? a.baseUrl}>Open</a>
              ) : state?.cta ? (
                <a className="btn-secondary mt-4" href={state.cta.href}>{state.cta.label}</a>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
