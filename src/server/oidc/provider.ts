import { shared } from "../shared";
import Provider, { type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env, issuer } from "@/lib/env";
import { log } from "@/lib/log";
import { db } from "../db/client";
import { memberships, oidcGrantOrgs, organizations, users } from "../db/schema";
import { allowedApps } from "../account/orgs";
import { PgAdapter } from "./adapter";
import { loadJwks } from "./keys";

/** Default API audience for JWT access tokens. */
export function apiResource() {
  return `${issuer()}/api`;
}

/** Entitlement summary claim (filled by Phase 3). */
export type EntClaim = (organizationId: string, appId: string) => Promise<Record<string, unknown> | null>;
const claimBox = shared("entClaim", () => ({ fn: (async () => null) as EntClaim }));
export function setEntitlementClaim(fn: EntClaim) {
  claimBox.fn = fn;
}

export async function orgForGrant(grantId: string | undefined) {
  if (!grantId) return null;
  const [g] = await db().select().from(oidcGrantOrgs).where(eq(oidcGrantOrgs.grantId, grantId));
  return g ?? null;
}

function grantIdOf(ctx: KoaContextWithOIDC, token: unknown): string | undefined {
  const t = token as { grantId?: string } | undefined;
  return t?.grantId ?? ctx.oidc?.entities?.Grant?.jti ?? (ctx.oidc?.entities?.AuthorizationCode as { grantId?: string } | undefined)?.grantId;
}

function cookieKeys() {
  const s = env().SESSION_SECRET;
  return [createHash("sha256").update(`oidc-cookies:${s}`).digest("base64url")];
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Inter,Helvetica,Arial,sans-serif;background:#f4f7f8;color:#123a4f;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;padding:32px;border-radius:10px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}button,a.b{background:#123a4f;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:14px;cursor:pointer;text-decoration:none}</style>
</head><body><div class="c">${body}</div></body></html>`;
}

export async function buildProvider() {
  const jwks = await loadJwks();
  const configuration: Configuration = {
    adapter: PgAdapter,
    jwks: { keys: jwks.keys as never },
    cookies: { keys: cookieKeys(), long: { signed: true, sameSite: "lax" }, short: { signed: true, sameSite: "lax" } },
    pkce: { required: () => true },
    clientDefaults: { id_token_signed_response_alg: "ES256", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "client_secret_basic" },
    enabledJWA: { idTokenSigningAlgValues: ["ES256"] } as never,
    routes: {
      authorization: "/oidc/auth",
      token: "/oidc/token",
      jwks: "/oidc/jwks",
      userinfo: "/oidc/me",
      end_session: "/oidc/session/end",
      revocation: "/oidc/token/revocation",
      introspection: "/oidc/token/introspection",
    },
    interactions: { url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
    scopes: ["openid", "offline_access", "profile", "email", "org", "entitlements", "entitlements:read", "usage:write", "events:write"],
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"],
      org: ["org_id", "org_name", "org_role", "app_access"],
      entitlements: ["ent"],
    },
    conformIdTokenClaims: false,
    features: {
      devInteractions: { enabled: false },
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        logoutSource: async (ctx, form) => {
          ctx.body = page("Sign out", `<h2>Sign out of Sentire?</h2><p>You will be signed out of every Sentire app.</p>${form}<button form="op.logoutForm" name="logout" value="yes" autofocus>Sign out</button><script>document.forms[0].submit()</script>`);
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.body = page("Signed out", `<h2>You are signed out</h2><p><a class="b" href="/sign-in">Sign in again</a></p>`);
        },
      },
      revocation: { enabled: true },
      introspection: { enabled: true },
      clientCredentials: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => apiResource(),
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== apiResource()) throw new Error("unknown resource");
          return { scope: "openid profile email org entitlements entitlements:read usage:write events:write", audience: resource, accessTokenTTL: 600, accessTokenFormat: "jwt", jwt: { sign: { alg: "ES256" } } };
        },
      },
    },
    ttl: {
      AccessToken: 600,
      AuthorizationCode: 60,
      ClientCredentials: 300,
      IdToken: 3600,
      Interaction: 3600,
      Session: 7 * 86_400,
      Grant: 7 * 86_400,
      RefreshToken: 12 * 3600,
    },
    extraTokenClaims: async (_ctx, token) => {
      const g = await orgForGrant((token as { grantId?: string }).grantId);
      return g ? { org_id: g.organizationId } : undefined;
    },
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    async findAccount(ctx, sub, token) {
      const [u] = await db().select().from(users).where(eq(users.id, sub));
      if (!u || u.status === "DISABLED") return undefined;
      return {
        accountId: u.id,
        async claims() {
          const base: Record<string, unknown> = { sub: u.id, email: u.email, email_verified: u.emailVerified, name: u.name };
          const g = await orgForGrant(grantIdOf(ctx, token));
          if (g) {
            const [row] = await db()
              .select({ org: organizations, role: memberships.role, status: memberships.status })
              .from(memberships)
              .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
              .where(and(eq(memberships.organizationId, g.organizationId), eq(memberships.userId, u.id)));
            const appId = ctx.oidc?.client?.clientId?.replace(/^sentire-/, "") ?? "";
            if (row && row.status === "ACTIVE") {
              base.org_id = g.organizationId;
              base.org_name = row.org.tradeName ?? row.org.registeredName;
              base.org_role = row.role;
              base.app_access = (await allowedApps(u.id, g.organizationId)).includes(appId);
              const ent = await claimBox.fn(g.organizationId, appId);
              if (ent) base.ent = ent;
            }
          }
          return base as { sub: string };
        },
      };
    },
    renderError: async (ctx, out) => {
      ctx.type = "html";
      ctx.body = page("Sign-in problem", `<h2>Sign-in could not continue</h2><p>${String(out.error_description ?? out.error).replace(/[<>&]/g, "")}</p><p><a class="b" href="/">Back to Sentire Cloud</a></p>`);
    },
    clientBasedCORS: () => true,
  };
  const provider = new Provider(issuer(), configuration);
  provider.proxy = true;
  provider.on("server_error", (_ctx, err) => log.error({ err }, "oidc server error"));
  return { provider, jwksVersion: jwks.version };
}
