import { verifyBearer, AuthError, type TokenInfo } from "./bearer";

/** The calling app from a client_credentials token (client_id sentire-<appId>). */
export async function requireAppToken(req: Request, scope: string): Promise<{ appId: string; token: TokenInfo }> {
  const t = await verifyBearer(req, scope);
  const appId = t.client_id?.replace(/^sentire-/, "");
  if (!appId) throw new AuthError(403, "app token required");
  return { appId, token: t };
}
