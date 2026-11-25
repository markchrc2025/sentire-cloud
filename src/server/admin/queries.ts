import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditEntries, billingStatements, deliveries, entitlements, incidents, memberships, organizations, payments, plans, products, subscriptions, users, withholdings } from "../db/schema";

export async function dashboard() {
  const [c] = await db().execute<{ orgs: number; active: number; past_due: number; suspended: number; wht: number; failed: number; incidents: number; open_stmt: number }>(sql`
    select (select count(*)::int from organizations) orgs,
      (select count(*)::int from subscriptions where status='ACTIVE') active,
      (select count(*)::int from subscriptions where status='PAST_DUE') past_due,
      (select count(*)::int from subscriptions where status='SUSPENDED') suspended,
      (select count(*)::int from withholdings where status='PENDING' and certificate_key is not null) wht,
      (select count(*)::int from deliveries where status='FAILED') failed,
      (select count(*)::int from incidents where status <> 'RESOLVED') incidents,
      (select count(*)::int from billing_statements where status in ('OPEN','PARTIALLY_PAID')) open_stmt`);
  return c!;
}

export async function searchOrgs(q: string) {
  const like = `%${q}%`;
  return db()
    .select()
    .from(organizations)
    .where(q ? or(ilike(organizations.registeredName, like), ilike(organizations.tradeName, like), ilike(organizations.tin, like), ilike(organizations.billingEmail, like)) : undefined)
    .orderBy(desc(organizations.createdAt))
    .limit(50);
}

export async function orgDetail(id: string) {
  const [org] = await db().select().from(organizations).where(eq(organizations.id, id));
  if (!org) return null;
  const [members, subs, stmts, ents, audits, dels] = await Promise.all([
    db().select({ m: memberships, u: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.organizationId, id)),
    db().select({ s: subscriptions, p: plans, prod: products }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).innerJoin(products, eq(products.id, subscriptions.productId)).where(eq(subscriptions.organizationId, id)).orderBy(desc(subscriptions.createdAt)),
    db().select().from(billingStatements).where(eq(billingStatements.organizationId, id)).orderBy(desc(billingStatements.issueDate)),
    db().select().from(entitlements).where(eq(entitlements.organizationId, id)),
    db().select().from(auditEntries).where(eq(auditEntries.organizationId, id)).orderBy(desc(auditEntries.at)).limit(50),
    db().select().from(deliveries).where(eq(deliveries.organizationId, id)).orderBy(desc(deliveries.createdAt)).limit(30),
  ]);
  return { org, members, subs, stmts, ents, audits, dels };
}

export async function statementDetail(id: string) {
  const [st] = await db().select().from(billingStatements).where(eq(billingStatements.id, id));
  if (!st) return null;
  const pays = await db().select().from(payments).where(eq(payments.statementId, id)).orderBy(payments.createdAt);
  return { st, pays };
}

export async function withholdingQueue() {
  return db()
    .select({ w: withholdings, org: organizations, number: billingStatements.number })
    .from(withholdings)
    .innerJoin(organizations, eq(organizations.id, withholdings.organizationId))
    .innerJoin(billingStatements, eq(billingStatements.id, withholdings.statementId))
    .where(inArray(withholdings.status, ["PENDING", "REJECTED"]))
    .orderBy(withholdings.createdAt);
}

export async function auditSearch(q: { action?: string; org?: string }) {
  return db()
    .select()
    .from(auditEntries)
    .where(and(q.action ? ilike(auditEntries.action, `%${q.action}%`) : undefined, q.org ? eq(auditEntries.organizationId, q.org) : undefined))
    .orderBy(desc(auditEntries.at))
    .limit(200);
}

export { incidents };
