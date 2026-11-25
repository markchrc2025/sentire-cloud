import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { billingStatements, organizations, withholdings } from "../db/schema";
import { inOrg, type OrgContext } from "../db/dal";
import { requireRole } from "../account/orgs";
import { putFile } from "../storage";
import { audit } from "../audit";
import { BillingError } from "./statements";

/** UC-08 step 3: Billing Contact uploads the signed 2307 (PDF or image, up to 5 MB). */
export async function uploadCertificate(ctx: OrgContext, withholdingId: string, file: { name: string; type: string; body: Buffer }) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new BillingError("Upload a PDF, PNG or JPG.");
  if (file.body.length > 5 * 1024 * 1024) throw new BillingError("The file is larger than 5 MB.");
  const [w] = await db().select().from(withholdings).where(inOrg(ctx, withholdings.organizationId, eq(withholdings.id, withholdingId)));
  if (!w || !["PENDING", "REJECTED"].includes(w.status)) throw new BillingError("This withholding does not need a certificate.");
  const f = await putFile({ organizationId: ctx.organizationId, purpose: "2307", name: file.name, contentType: file.type, body: file.body, createdBy: ctx.actorId });
  await db().update(withholdings).set({ certificateKey: f.storageKey, certificateName: file.name, uploadedAt: new Date(), status: "PENDING", reason: null }).where(eq(withholdings.id, w.id));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "withholding.certificate_uploaded", entity: "withholding", entityId: w.id, ip: ctx.ip });
}

/** UC-08 step 4: staff accept or reject. */
export async function reviewCertificate(staffId: string, withholdingId: string, accept: boolean, reason?: string) {
  const [w] = await db().select().from(withholdings).where(eq(withholdings.id, withholdingId));
  if (!w?.certificateKey) throw new BillingError("No certificate uploaded.");
  if (!accept && !reason?.trim()) throw new BillingError("Give the reason for rejecting.");
  await db().update(withholdings).set({ status: accept ? "RECEIVED" : "REJECTED", reviewedBy: staffId, reviewedAt: new Date(), reason: accept ? null : reason }).where(eq(withholdings.id, w.id));
  await audit({ organizationId: w.organizationId, actorId: staffId, actorKind: "staff", action: accept ? "withholding.accepted" : "withholding.rejected", entity: "withholding", entityId: w.id, after: { reason } });
}

export async function orgWithholdings(ctx: OrgContext) {
  return db()
    .select({ w: withholdings, number: billingStatements.number })
    .from(withholdings)
    .innerJoin(billingStatements, eq(billingStatements.id, withholdings.statementId))
    .where(inOrg(ctx, withholdings.organizationId))
    .orderBy(desc(withholdings.createdAt));
}

/** CR-03: 2307s per quarter for Sentire's own returns. */
export async function quarterlyReport(quarter: string) {
  return db()
    .select({ w: withholdings, org: organizations, number: billingStatements.number })
    .from(withholdings)
    .innerJoin(organizations, eq(organizations.id, withholdings.organizationId))
    .innerJoin(billingStatements, eq(billingStatements.id, withholdings.statementId))
    .where(and(eq(withholdings.quarter, quarter)))
    .orderBy(organizations.registeredName);
}
