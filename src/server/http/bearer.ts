import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
import { issuer } from "@/lib/env";
import { loadJwks } from "../oidc/keys";
import { apiResource } from "../oidc/provider";

export interface TokenInfo extends JWTPayload {
  client_id?: string;
  scope?: string;
}

let cache: { at: number; set: ReturnType<typeof createLocalJWKSet> } | null = null;
async function keyset() {
  if (!cache || Date.now() - cache.at > 300_000) {
    const { keys } = await loadJwks();
    const pub = keys.map((k) => {
      const { d: _d, ...rest } = k as Record<string, unknown>;
      return rest;
    });
    cache = { at: Date.now(), set: createLocalJWKSet({ keys: pub as never }) };
  }
  return cache.set;
}

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** Verify a Sentire Cloud JWT access token (user or machine) and optionally a scope. */
export async function verifyBearer(req: Request, scope?: string): Promise<TokenInfo> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new AuthError(401, "missing bearer token");
  try {
    const { payload } = await jwtVerify(m[1]!, await keyset(), { issuer: issuer(), audience: apiResource() });
    const p = payload as TokenInfo;
    if (scope && !(p.scope ?? "").split(" ").includes(scope)) throw new AuthError(403, `missing scope ${scope}`);
    return p;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(401, "invalid token");
  }
}

export function authErrorResponse(e: unknown) {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status, headers: { "WWW-Authenticate": "Bearer" } });
  throw e;
}
