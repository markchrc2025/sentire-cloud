import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { oidcMount } from "@/server/oidc";
import { db } from "@/server/db/client";
import { apps } from "@/server/db/schema";
import { encrypt } from "@/lib/crypto";

export const BASE = "http://localhost:3999";
export const REDIRECT = "http://localhost:3999/cb";

export async function startOidc(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/oidc") || req.url?.startsWith("/.well-known")) return void oidcMount(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(3999, r));
  return server;
}

export async function registerTestApp(appId = "test", backchannel?: string) {
  const secret = "test-client-secret-test-client-secret";
  await db()
    .insert(apps)
    .values({ appId, name: `Sentire ${appId}`, engine: "TYPESCRIPT_KIT", baseUrl: BASE, oidcClientId: `sentire-${appId}`, oidcClientSecretEnc: encrypt(secret), redirectUris: [REDIRECT], backchannelLogoutUri: backchannel ?? null })
    .onConflictDoNothing();
  await db().update(apps).set({ oidcClientSecretEnc: encrypt(secret), redirectUris: [REDIRECT] }).where(eq(apps.appId, appId));
  return { clientId: `sentire-${appId}`, secret };
}

/** Minimal cookie jar browser for the code flow. */
export class Browser {
  jar = new Map<string, string>();
  constructor(sessionToken?: string) {
    if (sessionToken) this.jar.set("sc_session", sessionToken);
  }
  async get(url: string) {
    const res = await fetch(url.startsWith("http") ? url : BASE + url, { redirect: "manual", headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, ...v] = kv!.split("=");
      if (/expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(k!);
      else this.jar.set(k!, v.join("="));
    }
    return res;
  }
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Runs authorize -> interaction -> resume -> callback; returns the Location of each redirect. */
export async function authorize(b: Browser, clientId: string, scope = "openid email profile org offline_access", extra = "") {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", scope, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", prompt: "consent" });
  let res = await b.get(`/oidc/auth?${q}${extra}`);
  const hops: string[] = [];
  for (let i = 0; i < 6 && res.status >= 300 && res.status < 400; i++) {
    const loc = res.headers.get("location")!;
    hops.push(loc);
    if (loc.startsWith(REDIRECT)) break;
    if (!loc.startsWith("/oidc") && !loc.startsWith(BASE + "/oidc")) break;
    res = await b.get(loc);
  }
  return { hops, last: hops.at(-1) ?? "", verifier, status: res.status, body: res.status === 200 ? await res.text() : "" };
}

export async function exchange(code: string, verifier: string, clientId: string, secret: string) {
  const res = await fetch(`${BASE}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

export async function refresh(refreshToken: string, clientId: string, secret: string) {
  const res = await fetch(`${BASE}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

export function decodeJwt(t: string) {
  return JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
}
