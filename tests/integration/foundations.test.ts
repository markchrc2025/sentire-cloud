import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditEntries, incidents } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { inOrg, MissingOrganizationError, orgContext } from "@/server/db/dal";
import { probe, recordCheck } from "@/server/hosting/status";
import { pgError, resetDb } from "../helpers";

beforeEach(resetDb);

describe("audit log", () => {
  it("is append-only", async () => {
    await audit({ actorKind: "system", action: "test.created", entity: "test" });
    const [row] = await db().select().from(auditEntries);
    expect(row!.action).toBe("test.created");
    expect(await pgError(db().update(auditEntries).set({ action: "x" }).where(eq(auditEntries.id, row!.id)))).toMatch(/append-only/);
    expect(await pgError(db().delete(auditEntries).where(eq(auditEntries.id, row!.id)))).toMatch(/append-only/);
  });
});

describe("data-access layer", () => {
  it("refuses a missing organization", () => {
    expect(() => orgContext({ organizationId: "" })).toThrow(MissingOrganizationError);
    expect(() => inOrg({} as never, auditEntries.organizationId)).toThrow(MissingOrganizationError);
  });
});

describe("status checks", () => {
  const down = { id: "svc", up: false, slow: false, status: 0, ms: 10, error: "unreachable" };
  const up = { id: "svc", up: true, slow: false, status: 200, ms: 10 };

  it("opens an incident after two failures and resolves after three good checks", async () => {
    expect(await recordCheck(down, "Svc")).toBeNull();
    expect(await recordCheck(down, "Svc")).toBe("opened");
    expect(await recordCheck(down, "Svc")).toBeNull();
    expect(await recordCheck(up, "Svc")).toBeNull();
    expect(await recordCheck(up, "Svc")).toBeNull();
    expect(await recordCheck(up, "Svc")).toBe("resolved");
    const [inc] = await db().select().from(incidents);
    expect(inc!.status).toBe("RESOLVED");
  });

  it("treats a login redirect or 401 as up", async () => {
    const f = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;
    expect((await probe({ id: "a", url: "https://x" }, { fetchImpl: f(302) })).up).toBe(true);
    expect((await probe({ id: "a", url: "https://x" }, { fetchImpl: f(401) })).up).toBe(true);
    expect((await probe({ id: "a", url: "https://x" }, { fetchImpl: f(502) })).up).toBe(false);
  });
});
