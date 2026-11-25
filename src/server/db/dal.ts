import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Organization context. Every read or write of organization-owned data takes one,
 * so no query can forget the organization (System Design NFR-06).
 */
export interface OrgContext {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly actorKind: "user" | "staff" | "system" | "app";
  readonly ip?: string | null;
}

export class MissingOrganizationError extends Error {
  constructor() {
    super("Organization context is required for organization-owned data");
  }
}

export function orgContext(input: Partial<OrgContext> & { organizationId: string | null | undefined }): OrgContext {
  if (!input.organizationId) throw new MissingOrganizationError();
  return {
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? "user",
    ip: input.ip ?? null,
  };
}

/** WHERE organization_id = ctx AND (extra). Use for every organization-owned table. */
export function inOrg(ctx: OrgContext, column: PgColumn, ...extra: (SQL | undefined)[]): SQL {
  if (!ctx?.organizationId) throw new MissingOrganizationError();
  const conds = [eq(column, ctx.organizationId), ...extra.filter((c): c is SQL => !!c)];
  return conds.length === 1 ? conds[0]! : and(...conds)!;
}
