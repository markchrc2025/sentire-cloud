import { Messages, type SP } from "@/components/ui";
import { requireOrg } from "@/server/http/session";
import { featureInfo, openRequests } from "@/server/paywall/service";
import { decideAction } from "./requests-actions";

export const metadata = { title: "Upgrade requests" };

export default async function Requests({ searchParams }: { searchParams: SP }) {
  const { ctx, current } = await requireOrg();
  const sp = await searchParams;
  if (!["OWNER", "BILLING"].includes(current.role)) return <p className="muted">Only the Owner or Billing Contact sees upgrade requests.</p>;
  const reqs = await openRequests(ctx);
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Upgrade requests</h1>
      <div className="mt-4"><Messages sp={sp} /></div>
      {reqs.length === 0 ? <p className="muted">No open requests.</p> : null}
      <ul className="space-y-4">
        {await Promise.all(reqs.map(async ({ r, requester }) => {
          const info = await featureInfo(r.featureKey);
          return (
            <li key={r.id} className="card">
              <p><strong>{requester.name}</strong> asks for <strong>{info.name}</strong>{r.appId ? ` in Sentire ${r.appId[0]!.toUpperCase()}${r.appId.slice(1)}` : ""}.</p>
              {r.note ? <p className="muted mt-1 text-sm">&ldquo;{r.note}&rdquo;</p> : null}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <form action={decideAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="approve" value="1" />
                  <button className="btn">Approve and pay</button>
                </form>
                <form action={decideAction} className="flex gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input className="input" name="reason" placeholder="Reason for declining" required />
                  <button className="btn-secondary">Decline</button>
                </form>
              </div>
            </li>
          );
        }))}
      </ul>
    </div>
  );
}
