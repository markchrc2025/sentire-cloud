import { paywallFigures } from "@/server/paywall/service";

export const dynamic = "force-dynamic";

export default async function Paywall() {
  const rows = await paywallFigures();
  const byFeature = new Map<string, Record<string, number>>();
  for (const r of rows) byFeature.set(r.feature_key, { ...(byFeature.get(r.feature_key) ?? {}), [r.action]: r.n });
  return (
    <div className="card">
      <h2 className="font-semibold">Paywall figures</h2>
      <table className="data mt-2"><thead><tr><th>Feature</th><th>Cards shown</th><th>Upgrade clicks</th><th>Requests</th><th>Purchases</th></tr></thead>
        <tbody>{[...byFeature].map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.SHOWN ?? 0}</td><td>{v.UPGRADE_CLICKED ?? 0}</td><td>{v.REQUESTED ?? 0}</td><td>{v.PURCHASED ?? 0}</td></tr>)}</tbody></table>
    </div>
  );
}
