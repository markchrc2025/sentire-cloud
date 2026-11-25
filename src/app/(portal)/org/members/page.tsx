import { Messages, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { listInvitations, listMembers } from "@/server/account/orgs";
import { listApps } from "@/server/account/registry";
import { inviteAction, memberAction, revokeInviteAction } from "../../portal-actions";

export const metadata = { title: "Members" };
const ROLES = [["OWNER", "Owner"], ["ADMIN", "Admin"], ["BILLING", "Billing Contact"], ["MEMBER", "Member"]] as const;

export default async function Members({ searchParams }: { searchParams: SP }) {
  const { ctx, current, s } = await requireOrg();
  const sp = await searchParams;
  const [members, invites, apps] = await Promise.all([listMembers(ctx), listInvitations(ctx), listApps()]);
  const manage = current.role === "OWNER" || current.role === "ADMIN";
  return (
    <>
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="muted mt-1">Organization roles decide who manages the account. Roles inside each app (for example Ledger&apos;s Accountant) are set in that app.</p>
      <div className="mt-4"><Messages sp={sp} /></div>
      <div className="card mt-2 overflow-x-auto">
        <table className="data">
          <thead><tr><th>Name</th><th>Role</th><th>Apps</th>{manage ? <th></th> : null}</tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membership.id}>
                <td>{m.user.name}<div className="muted text-xs">{m.user.email}</div></td>
                <td>
                  {manage ? (
                    <form action={memberAction} className="flex gap-2">
                      <input type="hidden" name="membershipId" value={m.membership.id} />
                      <input type="hidden" name="op" value="role" />
                      <select name="role" defaultValue={m.membership.role} className="input py-1" aria-label="Role">
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <button className="btn-secondary py-1">Set</button>
                    </form>
                  ) : ROLES.find(([v]) => v === m.membership.role)?.[1]}
                </td>
                <td>
                  {manage ? (
                    <form action={memberAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="membershipId" value={m.membership.id} />
                      <input type="hidden" name="op" value="apps" />
                      {apps.map((a) => (
                        <label key={a.appId} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="apps" value={a.appId} defaultChecked={m.apps.includes(a.appId)} /> {a.name.replace("Sentire ", "")}
                        </label>
                      ))}
                      <button className="btn-secondary py-1">Save</button>
                    </form>
                  ) : m.apps.join(", ")}
                </td>
                {manage ? (
                  <td className="whitespace-nowrap">
                    {m.user.id !== s.user.id ? (
                      <div className="flex gap-2">
                        <form action={memberAction}>
                          <input type="hidden" name="membershipId" value={m.membership.id} />
                          <input type="hidden" name="op" value="remove" />
                          <button className="text-red-700 underline">Remove</button>
                        </form>
                        {current.role === "OWNER" ? (
                          <form action={memberAction}>
                            <input type="hidden" name="membershipId" value={m.membership.id} />
                            <input type="hidden" name="op" value="transfer" />
                            <button className="underline">Make Owner and step down</button>
                          </form>
                        ) : null}
                      </div>
                    ) : <span className="muted text-xs">You</span>}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manage ? (
        <div className="card mt-6">
          <h2 className="font-semibold">Invite someone</h2>
          <form action={inviteAction} className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
            <input className="input" name="email" type="email" placeholder="name@company.com" required aria-label="Email" />
            <select className="input" name="role" defaultValue="MEMBER" aria-label="Role">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              {apps.map((a) => (
                <label key={a.appId} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="apps" value={a.appId} /> {a.name}
                </label>
              ))}
            </div>
            <div><button className="btn">Send invitation</button></div>
          </form>
          {invites.length ? (
            <>
              <h3 className="mt-6 text-sm font-semibold">Waiting for an answer</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <span>{i.email} ({i.role.toLowerCase()}), until {i.expiresAt.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</span>
                    <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="underline">Withdraw</button></form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
