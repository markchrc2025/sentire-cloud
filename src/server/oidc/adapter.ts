import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Adapter, AdapterPayload } from "oidc-provider";
import { decrypt } from "@/lib/crypto";
import { db } from "../db/client";
import { apps, instances, oidcPayloads } from "../db/schema";

/** Postgres storage for oidc-provider. Clients come from the app registry. */
export class PgAdapter implements Adapter {
  constructor(private readonly model: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    const row = {
      id,
      model: this.model,
      payload: payload as never,
      grantId: (payload.grantId as string | undefined) ?? null,
      userCode: (payload.userCode as string | undefined) ?? null,
      uid: (payload.uid as string | undefined) ?? null,
      accountId: (payload.accountId as string | undefined) ?? null,
      expiresAt,
    };
    await db()
      .insert(oidcPayloads)
      .values(row)
      .onConflictDoUpdate({ target: [oidcPayloads.model, oidcPayloads.id], set: { ...row, consumedAt: null } });
  }

  private async findWhere(cond: ReturnType<typeof eq>) {
    const [r] = await db()
      .select()
      .from(oidcPayloads)
      .where(and(eq(oidcPayloads.model, this.model), cond, or(isNull(oidcPayloads.expiresAt), sql`${oidcPayloads.expiresAt} > now()`)))
      .limit(1);
    if (!r) return undefined;
    const p = r.payload as AdapterPayload;
    return r.consumedAt ? { ...p, consumed: Math.floor(r.consumedAt.getTime() / 1000) } : p;
  }

  async find(id: string) {
    if (this.model === "Client") return findClient(id);
    return this.findWhere(eq(oidcPayloads.id, id));
  }

  async findByUserCode(userCode: string) {
    return this.findWhere(eq(oidcPayloads.userCode, userCode));
  }

  async findByUid(uid: string) {
    return this.findWhere(eq(oidcPayloads.uid, uid));
  }

  async consume(id: string) {
    await db().update(oidcPayloads).set({ consumedAt: new Date() }).where(and(eq(oidcPayloads.model, this.model), eq(oidcPayloads.id, id)));
  }

  async destroy(id: string) {
    await db().delete(oidcPayloads).where(and(eq(oidcPayloads.model, this.model), eq(oidcPayloads.id, id)));
  }

  async revokeByGrantId(grantId: string) {
    await db().delete(oidcPayloads).where(eq(oidcPayloads.grantId, grantId));
  }
}

async function findClient(clientId: string): Promise<AdapterPayload | undefined> {
  const [a] = await db().select().from(apps).where(eq(apps.oidcClientId, clientId)).limit(1);
  if (!a || !a.active || !a.oidcClientSecretEnc) return undefined;
  // Multi-site apps: every instance's callback is an allowed redirect.
  const callback = a.instancePaths.callback;
  const extra = callback
    ? (await db().select({ baseUrl: instances.baseUrl }).from(instances).where(and(eq(instances.appId, a.appId), isNotNull(instances.baseUrl)))).map((i) => i.baseUrl!.replace(/\/$/, "") + callback)
    : [];
  const redirectUris = [...new Set([...a.redirectUris, ...extra])];
  if (!redirectUris.length) return undefined;
  return {
    client_id: a.oidcClientId,
    client_secret: decrypt(a.oidcClientSecretEnc),
    client_name: a.name,
    redirect_uris: redirectUris,
    post_logout_redirect_uris: a.postLogoutRedirectUris,
    grant_types: ["authorization_code", "refresh_token", "client_credentials"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: "openid offline_access profile email org entitlements entitlements:read usage:write events:write",
    ...(a.backchannelLogoutUri ? { backchannel_logout_uri: a.backchannelLogoutUri, backchannel_logout_session_required: true } : {}),
  } as AdapterPayload;
}

export async function purgeExpiredOidcPayloads() {
  await db().delete(oidcPayloads).where(lt(oidcPayloads.expiresAt, new Date(Date.now() - 86_400_000)));
}
