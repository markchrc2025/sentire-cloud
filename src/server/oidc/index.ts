import { shared } from "../shared";
import type { IncomingMessage, ServerResponse } from "node:http";
import type Provider from "oidc-provider";
import { and, eq, inArray } from "drizzle-orm";
import { log } from "@/lib/log";
import { db } from "../db/client";
import { apps, oidcGrantOrgs, oidcPayloads } from "../db/schema";
import { loadSession, parseCookie, SESSION_COOKIE } from "../account/sessions";
import { allowedApps, memberAccessHooks, myOrganizations } from "../account/orgs";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { hasSecondFactor } from "../account/mfa";

async function needsSecondFactor(userId: string, platformRole: string) {
  const orgs = await myOrganizations(userId);
  const must = platformRole !== "NONE" || orgs.some((o) => o.role === "OWNER");
  return must && !(await hasSecondFactor(userId));
}
import { buildProvider, apiResource } from "./provider";
import { loadJwks } from "./keys";

const g = globalThis as unknown as { __oidc?: { provider: Provider; jwksVersion: string; checkedAt: number } };

/** The provider, rebuilt when signing keys rotate (checked every 10 minutes). */
export async function getProvider(): Promise<Provider> {
  const now = Date.now();
  if (!g.__oidc) {
    g.__oidc = { ...(await buildProvider()), checkedAt: now };
  } else if (now - g.__oidc.checkedAt > 600_000) {
    g.__oidc.checkedAt = now;
    const { version } = await loadJwks();
    if (version !== g.__oidc.jwksVersion) g.__oidc = { ...(await buildProvider()), checkedAt: now };
  }
  return g.__oidc.provider;
}

/** Entitlement gate for sign-in (Phase 3). Returns "ACTIVE" | "READ_ONLY" | "OFF". */
export type EntGate = (organizationId: string, appId: string) => Promise<"ACTIVE" | "READ_ONLY" | "OFF">;
const gateBox = shared("entGate", () => ({ fn: (async () => "ACTIVE") as EntGate }));
export function setEntitlementGate(fn: EntGate) {
  gateBox.fn = fn;
}

function redirect(res: ServerResponse, to: string) {
  res.statusCode = 303;
  res.setHeader("Location", to);
  res.end();
}

/** GET /oidc/interaction/:uid: UC-02 steps 3 to 5, handled against the Sentire Cloud session. */
async function interaction(req: IncomingMessage, res: ServerResponse, provider: Provider) {
  const url = new URL(req.url!, "http://x");
  const uid = url.pathname.split("/")[3]!;
  const details = await provider.interactionDetails(req, res);
  const back = `/oidc/interaction/${uid}`;
  const s = await loadSession(parseCookie(req.headers.cookie, SESSION_COOKIE));
  if (!s) return redirect(res, `/sign-in?next=${encodeURIComponent(back)}`);
  const clientId = String(details.params.client_id);
  const [app] = await db().select().from(apps).where(eq(apps.oidcClientId, clientId));
  if (!app) return redirect(res, `/no-access?reason=app`);

  const orgs = await myOrganizations(s.user.id);
  const eligible: string[] = [];
  for (const o of orgs) if ((await allowedApps(s.user.id, o.org.id)).includes(app.appId)) eligible.push(o.org.id);
  if (eligible.length === 0) return redirect(res, `/no-access?app=${app.appId}`);
  if (await needsSecondFactor(s.user.id, s.user.platformRole)) return redirect(res, `/account/security?required=1`);

  let orgId = url.searchParams.get("org");
  if (orgId && !eligible.includes(orgId)) orgId = null;
  if (!orgId) {
    if (eligible.length === 1) orgId = eligible[0]!;
    else return redirect(res, `/choose-organization?uid=${uid}&app=${app.appId}`);
  }
  const state = await gateBox.fn(orgId, app.appId);
  if (state === "OFF") return redirect(res, `/no-access?app=${app.appId}&org=${orgId}&reason=subscription`);

  const grant = new provider.Grant({ accountId: s.user.id, clientId });
  const scope = String(details.params.scope ?? "openid");
  grant.addOIDCScope(scope);
  grant.addResourceScope(apiResource(), scope);
  const grantId = await grant.save();
  await db().insert(oidcGrantOrgs).values({ grantId, organizationId: orgId, userId: s.user.id, clientId }).onConflictDoNothing();
  await audit({ organizationId: orgId, actorId: s.user.id, action: "app.signed_in", entity: "app", entityId: app.appId, after: { state } });
  await provider.interactionFinished(req, res, { login: { accountId: s.user.id }, consent: { grantId } }, { mergeWithLastSubmission: false });
}

/** Ends provider sessions and app sign-ins for a user, optionally only for one organization and some apps (FR-03, FR-10). */
export async function endAppSessions(userId: string, organizationId?: string, appIds?: string[] | "all") {
  const provider = await getProvider();
  const grants = await db()
    .select()
    .from(oidcGrantOrgs)
    .where(organizationId ? and(eq(oidcGrantOrgs.userId, userId), eq(oidcGrantOrgs.organizationId, organizationId)) : eq(oidcGrantOrgs.userId, userId));
  const targetClients = new Set(
    grants
      .filter((gr) => !appIds || appIds === "all" || appIds.includes(gr.clientId.replace(/^sentire-/, "")))
      .map((gr) => gr.clientId),
  );
  const grantIds = grants.filter((gr) => targetClients.has(gr.clientId)).map((gr) => gr.grantId);
  // Back-channel logout to each app that has a session for this user.
  const sessionRows = await db().select().from(oidcPayloads).where(and(eq(oidcPayloads.model, "Session"), eq(oidcPayloads.accountId, userId)));
  for (const row of sessionRows) {
    const p = row.payload as { authorizations?: Record<string, { sid?: string; grantId?: string }> };
    const auths = p.authorizations ?? {};
    for (const [clientId, a] of Object.entries(auths)) {
      if (!targetClients.has(clientId) && !(a.grantId && grantIds.includes(a.grantId))) continue;
      try {
        const client = await provider.Client.find(clientId);
        const c = client as unknown as { backchannelLogoutUri?: string; backchannelLogout(sub: string, sid: string): Promise<void> } | undefined;
        if (c?.backchannelLogoutUri && a.sid) await c.backchannelLogout(userId, a.sid);
      } catch (e) {
        log.warn({ clientId, err: (e as Error).message }, "back-channel logout failed");
      }
      delete auths[clientId];
    }
    if (!organizationId || Object.keys(auths).length === 0) await db().delete(oidcPayloads).where(and(eq(oidcPayloads.model, "Session"), eq(oidcPayloads.id, row.id)));
    else await db().update(oidcPayloads).set({ payload: { ...p, authorizations: auths } as never }).where(and(eq(oidcPayloads.model, "Session"), eq(oidcPayloads.id, row.id)));
  }
  // Multi-site apps (one back-channel URI cannot reach every site) hear it as an event on the organization's instance.
  const orgs = organizationId ? [organizationId] : [...new Set(grants.map((gr) => gr.organizationId))];
  for (const o of orgs) await publish("account.sessions.revoked", o, { userId, appIds: appIds && appIds !== "all" ? appIds : "all" });
  if (grantIds.length) {
    await db().delete(oidcPayloads).where(inArray(oidcPayloads.grantId, grantIds));
    await db().delete(oidcPayloads).where(and(eq(oidcPayloads.model, "Grant"), inArray(oidcPayloads.id, grantIds)));
  }
}

memberAccessHooks.onAccessRemoved = async (userId, orgId, appIdsOrAll) => {
  await endAppSessions(userId, orgId, appIdsOrAll);
};

/** Mounted at /oidc and /.well-known on the custom server. */
export async function oidcMount(req: IncomingMessage, res: ServerResponse) {
  const provider = await getProvider();
  if (req.url?.startsWith("/oidc/interaction/") && req.method === "GET") {
    try {
      return await interaction(req, res, provider);
    } catch (e) {
      log.warn({ err: (e as Error).message }, "interaction failed");
      return redirect(res, "/no-access?reason=expired");
    }
  }
  return provider.callback()(req, res);
}
