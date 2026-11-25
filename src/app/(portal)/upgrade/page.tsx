import { redirect } from "next/navigation";
import { Messages, str, type SP } from "@/components/ui";
import { requireSession } from "@/server/http/session";
import { myOrganizations } from "@/server/account/orgs";
import { setCurrentOrganization } from "@/server/account/sessions";
import { recordPaywallEvent, upgradeCard } from "@/server/paywall/service";
import { askOwnerAction, buyUpgradeAction } from "./upgrade-actions";

export const metadata = { title: "Unlock a feature" };

/** FR-47: /upgrade?org=&feature=&return=&app= from the upgrade card in any app. */
export default async function Upgrade({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  const s = await requireSession(`/upgrade?${q}`);
  const orgId = str(sp.org) ?? "";
  const feature = str(sp.feature) ?? "";
  const appId = str(sp.app) ?? "ledger";
  const ret = str(sp.return) ?? "";
  const m = (await myOrganizations(s.user.id)).find((o) => o.org.id === orgId);
  if (!m) redirect("/org");
  if (s.session.currentOrganizationId !== orgId) await setCurrentOrganization(s.session.id, orgId);
  const card = await upgradeCard(orgId, appId, feature);
  if (!sp.error && !sp.ok) await recordPaywallEvent(orgId, appId, feature, s.user.id, "UPGRADE_CLICKED");
  const canBuy = m.role === "OWNER" || m.role === "BILLING";
  return (
    <div className="mx-auto max-w-lg">
      <div className="card">
        <p className="muted text-sm">{m.org.tradeName ?? m.org.registeredName}</p>
        <h1 className="mt-1 text-xl font-semibold">{card.feature.name}</h1>
        <p className="mt-2">{card.feature.benefit}</p>
        <div className="mt-4"><Messages sp={sp} /></div>
        {!card.option ? (
          <p className="muted mt-4 text-sm">This is not on sale yet. Contact Sentire to turn it on.</p>
        ) : canBuy ? (
          <form action={buyUpgradeAction} className="mt-4">
            {Object.entries({ org: orgId, feature, app: appId, return: ret }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <p className="text-sm">Unlocked by <strong>{card.option.name}</strong> ({card.option.kind === "PLAN" ? "plan" : "add-on"}), {card.priceText}. You pay only for the time left in your current period.</p>
            <button className="btn mt-4">Upgrade</button>
            {ret ? <a className="btn-secondary ml-2 mt-4" href={ret}>Not now</a> : null}
          </form>
        ) : (
          <form action={askOwnerAction} className="mt-4 space-y-3">
            {Object.entries({ org: orgId, feature, app: appId, return: ret }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <p className="text-sm">Your Owner or Billing Contact decides on upgrades. We will tell them you asked.</p>
            <textarea className="input" name="note" maxLength={500} placeholder="Why do you need it? (optional)" />
            <button className="btn">Ask my Owner</button>
            {ret ? <a className="btn-secondary ml-2" href={ret}>Back to the app</a> : null}
          </form>
        )}
      </div>
    </div>
  );
}
