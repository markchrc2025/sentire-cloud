import { Brand } from "@/components/Brand";
import { currentStatus } from "@/server/hosting/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status" };

function pct(v: number | null) {
  return v === null ? "n/a" : `${(v * 100).toFixed(v === 1 ? 0 : 2)}%`;
}

function Dot({ up, slow }: { up: boolean | null; slow: boolean }) {
  const cls = up === null ? "bg-gray-300" : !up ? "bg-red-600" : slow ? "bg-gold" : "bg-emerald-600";
  const label = up === null ? "Not checked yet" : !up ? "Down" : slow ? "Slow" : "Up";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden /> {label}
    </span>
  );
}

const manila = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export default async function StatusPage() {
  const { services, incidents } = await currentStatus();
  const allUp = services.every((s) => s.up !== false);
  const groups = [
    { key: "product", title: "Sentire apps" },
    { key: "platform", title: "Platform services" },
  ] as const;
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Brand />
      <div className={`card mt-8 ${allUp ? "ring-emerald-600/30" : "ring-red-600/40"}`}>
        <h1 className="text-xl font-semibold">{allUp ? "All systems working" : "Some services have a problem"}</h1>
        <p className="muted mt-1 text-sm">Checked every minute. Times are Manila time.</p>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="card mt-6">
          <h2 className="mb-3 font-semibold">{g.title}</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Service</th>
                <th>Now</th>
                <th>Response</th>
                <th>24 hours</th>
                <th>30 days</th>
              </tr>
            </thead>
            <tbody>
              {services
                .filter((s) => s.group === g.key)
                .map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td><Dot up={s.up} slow={s.slow} /></td>
                    <td>{s.ms === null ? "n/a" : `${s.ms} ms`}</td>
                    <td>{pct(s.uptime24h)}</td>
                    <td>{pct(s.uptime30d)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <section className="card mt-6">
        <h2 className="mb-3 font-semibold">Incidents, last 30 days</h2>
        {incidents.length === 0 ? (
          <p className="muted text-sm">No incidents.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {incidents.map((i) => (
              <li key={i.id}>
                <span className="font-medium">{i.title}</span>{" "}
                <span className="muted">
                  {manila.format(i.startedAt)} {i.resolvedAt ? `to ${manila.format(i.resolvedAt)}, resolved` : "(ongoing)"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
