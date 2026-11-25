import { AuthShell, str, type SP } from "@/components/ui";
import { requireSession } from "@/server/http/session";
import { allowedApps, myOrganizations } from "@/server/account/orgs";

export const metadata = { title: "Choose an organization" };

export default async function Choose({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const uid = str(sp.uid) ?? "";
  const app = str(sp.app) ?? "";
  const s = await requireSession(`/oidc/interaction/${uid}`);
  const orgs = await myOrganizations(s.user.id);
  const eligible = [];
  for (const o of orgs) if ((await allowedApps(s.user.id, o.org.id)).includes(app)) eligible.push(o);
  return (
    <AuthShell title="Which organization?" subtitle="You belong to more than one. Choose the one to open the app for.">
      <ul className="space-y-2">
        {eligible.map((o) => (
          <li key={o.org.id}>
            <a className="btn-secondary w-full justify-between" href={`/oidc/interaction/${uid}?org=${o.org.id}`}>
              <span>{o.org.tradeName ?? o.org.registeredName}</span>
              <span className="muted text-xs">{o.role.toLowerCase()}</span>
            </a>
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}
