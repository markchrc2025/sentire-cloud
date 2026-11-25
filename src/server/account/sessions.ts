import { and, eq, gt, isNull } from "drizzle-orm";
import { randomToken, sha256 } from "@/lib/crypto";
import { db, type DBorTx } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "sc_session";
export const SESSION_DAYS = 7;

export type SessionUser = typeof users.$inferSelect;
export interface LoadedSession {
  session: typeof sessions.$inferSelect;
  user: SessionUser;
}

export async function createSession(
  userId: string,
  opts: { pendingMfa?: boolean; ip?: string | null; device?: string | null; organizationId?: string | null } = {},
  tx: DBorTx = db(),
) {
  const token = randomToken();
  const [s] = await tx
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      pendingMfa: opts.pendingMfa ?? false,
      ipAddress: opts.ip ?? null,
      deviceLabel: opts.device ?? null,
      currentOrganizationId: opts.organizationId ?? null,
      expiresAt: new Date(Date.now() + (opts.pendingMfa ? 10 * 60_000 : SESSION_DAYS * 86_400_000)),
    })
    .returning();
  return { token, session: s! };
}

/** Load an active session from its cookie token. Pending-MFA sessions load only with allowPending. */
export async function loadSession(token: string | undefined | null, { allowPending = false } = {}): Promise<LoadedSession | null> {
  if (!token) return null;
  const rows = await db()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.session.pendingMfa && !allowPending) return null;
  if (r.user.status === "DISABLED") return null;
  // Touch at most once a minute.
  if (Date.now() - r.session.lastSeenAt.getTime() > 60_000) {
    await db().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, r.session.id));
  }
  return r;
}

export async function revokeSession(sessionId: string, userId: string) {
  await db().update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string, tx: DBorTx = db()) {
  const rows = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const r of rows) if (r.id !== exceptSessionId) await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, r.id));
}

export async function setCurrentOrganization(sessionId: string, organizationId: string | null) {
  await db().update(sessions).set({ currentOrganizationId: organizationId }).where(eq(sessions.id, sessionId));
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
