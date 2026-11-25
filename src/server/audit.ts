import type { DBorTx } from "./db/client";
import { db } from "./db/client";
import { auditEntries } from "./db/schema";

export interface AuditInput {
  organizationId?: string | null;
  actorId?: string | null;
  actorKind?: "user" | "staff" | "system" | "app";
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Write an audit entry. Pass the transaction so the entry commits with the change. */
export async function audit(input: AuditInput, tx: DBorTx = db()) {
  await tx.insert(auditEntries).values({
    organizationId: input.organizationId ?? null,
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? "user",
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    ipAddress: input.ip ?? null,
  });
}
