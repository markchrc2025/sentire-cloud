import { cookies } from "next/headers";
import { Messages, Notice, type SP } from "@/components/ui";
import { listApps } from "@/server/account/registry";
import { appAction } from "../admin-actions";

export const dynamic = "force-dynamic";

export default async function Apps({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const apps = await listApps();
  const flash = sp.ok ? (await cookies()).get("sc_secret")?.value : undefined;
  const [fApp, fKind, fSecret] = flash?.split(":") ?? [];
  return (
    <div className="space-y-4">
      <Messages sp={sp} />
      {fSecret ? <Notice kind="success">New {fKind === "oidc" ? "OIDC client" : "event"} secret for {fApp}: <code className="break-all">{fSecret}</code>. Put it in the app&apos;s environment now; it will not be shown again.</Notice> : null}
      {apps.map((a) => (
        <form key={a.appId} action={appAction} className="card grid gap-2 md:grid-cols-2">
          <input type="hidden" name="appId" value={a.appId} /><input type="hidden" name="op" value="save" />
          <h2 className="font-semibold md:col-span-2">{a.name} <span className="muted text-xs">client_id {a.oidcClientId} · {a.oidcClientSecretEnc ? "client secret set" : "no client secret"} · {a.eventSecretEnc ? "event secret set" : "no event secret"}</span></h2>
          <label className="text-xs">Base URL<input className="input" name="baseUrl" defaultValue={a.baseUrl} /></label>
          <label className="text-xs">Redirect URIs (space separated)<input className="input" name="redirectUris" defaultValue={a.redirectUris.join(" ")} /></label>
          <label className="text-xs">Post-logout redirect URIs<input className="input" name="postLogoutRedirectUris" defaultValue={a.postLogoutRedirectUris.join(" ")} /></label>
          <label className="text-xs">Back-channel logout URI<input className="input" name="backchannelLogoutUri" defaultValue={a.backchannelLogoutUri ?? ""} /></label>
          <label className="text-xs">Event endpoint<input className="input" name="eventEndpoint" defaultValue={a.eventEndpoint ?? ""} /></label>
          <label className="text-xs">Accepts events (blank = all account and billing)<input className="input" name="acceptsEvents" defaultValue={a.acceptsEvents.join(" ")} /></label>
          <label className="text-xs">Provisioning URL<input className="input" name="provisionUrl" defaultValue={a.provisionUrl ?? ""} /></label>
          <label className="text-xs">Health URL<input className="input" name="healthUrl" defaultValue={a.healthUrl ?? ""} /></label>
          <label className="text-xs md:col-span-2">Paths on each organization&apos;s site (multi-site apps, JSON: events, callback, export, delete, suspend, resume, health)<input className="input font-mono" name="instancePaths" defaultValue={JSON.stringify(a.instancePaths)} /></label>
          <div className="flex gap-2 md:col-span-2">
            <button className="btn">Save</button>
            <button className="btn-secondary" name="op" value="oidc">New OIDC client secret</button>
            <button className="btn-secondary" name="op" value="event">New event secret</button>
          </div>
        </form>
      ))}
    </div>
  );
}
