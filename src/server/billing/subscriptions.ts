import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type DBorTx } from "../db/client";
import { addOns, billingStatements, memberships, organizations, plans, prices, products, statementLines, subscriptionItems, subscriptions, users } from "../db/schema";
import { inOrg, type OrgContext } from "../db/dal";
import { requireRole } from "../account/orgs";
import { addDays, addMonths, daysBetween, manilaDate } from "@/lib/time";
import { formatPHP, mulDiv } from "@/lib/money";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { sendMail } from "../mail/send";
import { billingMails } from "./mails";
import { BillingError, createStatement, type LineInput } from "./statements";
import { priceFor } from "./catalog";
import { subscriptionChanged } from "./hooks";

export const LIVE = ["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED"] as const;
type Cycle = "MONTHLY" | "ANNUAL";

export function periodEnd(start: string, cycle: Cycle, anchorDay?: number) {
  return addMonths(start, cycle === "ANNUAL" ? 12 : 1, anchorDay);
}

function cycleWord(cycle: Cycle) {
  return cycle === "ANNUAL" ? "1 year" : "1 month";
}

async function planAndProduct(planId: string, tx: DBorTx = db()) {
  const [row] = await tx.select({ plan: plans, product: products }).from(plans).innerJoin(products, eq(products.id, plans.productId)).where(eq(plans.id, planId));
  if (!row) throw new BillingError("Plan not found.");
  return row;
}

async function addOnRows(ids: string[], productId: string, planRank: number, tx: DBorTx = db()) {
  if (!ids.length) return [];
  const rows = await tx.select().from(addOns).where(inArray(addOns.id, ids));
  for (const a of rows) {
    if (!a.onSale) throw new BillingError(`${a.name} is not on sale.`);
    if (a.productId && a.productId !== productId) throw new BillingError(`${a.name} is not for this product.`);
    if (planRank < a.minPlanRank) throw new BillingError(`${a.name} needs a higher plan.`);
  }
  return rows;
}

/** Lines for the first statement: setup fee, first period of the plan and add-ons (UC-04 step 2). */
export async function quote(planId: string, cycle: Cycle, addOnIds: string[] = []) {
  const { plan, product } = await planAndProduct(planId);
  if (!plan.onSale || !product.onSale) throw new BillingError("This plan is not on sale.");
  const price = await priceFor({ planId }, cycle);
  if (!price) throw new BillingError(`${plan.name} is not sold ${cycle === "ANNUAL" ? "yearly" : "monthly"}.`);
  const lines: (LineInput & { priceId: string })[] = [];
  if (price.setupFeeCentavos > 0) lines.push({ kind: "SETUP_FEE", description: `${product.name} setup, ${plan.name}`, unitCentavos: price.setupFeeCentavos, priceId: price.id });
  lines.push({ kind: "PLAN", description: `${product.name} ${plan.name}, ${cycleWord(cycle)} from the date of payment`, unitCentavos: price.amountCentavos, priceId: price.id });
  for (const a of await addOnRows(addOnIds, product.id, plan.rank)) {
    const ap = await priceFor({ addOnId: a.id }, cycle);
    if (!ap) throw new BillingError(`${a.name} has no ${cycle.toLowerCase()} price.`);
    lines.push({ kind: "ADD_ON", description: `${a.name}, ${cycleWord(cycle)}`, unitCentavos: ap.amountCentavos, priceId: ap.id });
  }
  return { plan, product, price, lines, total: lines.reduce((s, l) => s + l.unitCentavos, 0) };
}

/** UC-04 steps 1 to 4: Pending subscription and its first statement. */
export async function subscribe(ctx: OrgContext, input: { planId: string; cycle: Cycle; addOnIds?: string[]; method: "ONLINE" | "BANK_TRANSFER" }) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  const q = await quote(input.planId, input.cycle, input.addOnIds ?? []);
  const today = manilaDate();
  return db().transaction(async (tx) => {
    const live = await tx
      .select()
      .from(subscriptions)
      .where(inOrg(ctx, subscriptions.organizationId, eq(subscriptions.productId, q.product.id), inArray(subscriptions.status, [...LIVE])));
    if (live.length) throw new BillingError(`Your organization already has a ${q.product.name} subscription. Change its plan instead.`);
    const [sub] = await tx
      .insert(subscriptions)
      .values({ organizationId: ctx.organizationId, productId: q.product.id, planId: q.plan.id, cycle: input.cycle, status: "PENDING", anchorDay: Number(today.slice(8, 10)) })
      .returning();
    await tx.insert(subscriptionItems).values([
      { organizationId: ctx.organizationId, subscriptionId: sub!.id, kind: "PLAN" as const, priceId: q.price.id },
      ...q.lines.filter((l) => l.kind === "ADD_ON").map((l, i) => ({ organizationId: ctx.organizationId, subscriptionId: sub!.id, kind: "ADD_ON" as const, priceId: l.priceId, addOnId: (input.addOnIds ?? [])[i] ?? null })),
    ]);
    const st = await createStatement(
      {
        organizationId: ctx.organizationId,
        sellerProfileId: q.product.sellerProfileId,
        subscriptionId: sub!.id,
        kind: "INITIAL",
        issueDate: today,
        dueDate: input.method === "BANK_TRANSFER" ? addDays(today, 7) : today,
        lines: q.lines,
        actorId: ctx.actorId,
      },
      tx,
    );
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "subscription.created", entity: "subscription", entityId: sub!.id, after: { plan: q.plan.code, cycle: input.cycle, method: input.method }, ip: ctx.ip }, tx);
    if (input.method === "BANK_TRANSFER") await mailStatement(st.id, tx);
    return { subscription: sub!, statement: st };
  });
}

export async function mailStatement(statementId: string, tx: DBorTx = db()) {
  const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, statementId));
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, st!.organizationId));
  await sendMail({ to: org!.billingEmail, ...billingMails.statement(st!, org!) });
}

/** Called when a statement becomes fully settled. Activates, renews or applies a change (UC-04 step 6, UC-06 step 3). */
export async function onStatementPaid(statementId: string, tx: DBorTx) {
  const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, statementId));
  if (!st?.subscriptionId) return;
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, st.subscriptionId));
  if (!sub) return;
  const today = manilaDate();
  if (st.kind === "INITIAL" && sub.status === "PENDING") {
    const end = periodEnd(today, sub.cycle, Number(today.slice(8, 10)));
    await tx.update(subscriptions).set({ status: "ACTIVE", currentPeriodStart: today, currentPeriodEnd: end, anchorDay: Number(today.slice(8, 10)) }).where(eq(subscriptions.id, sub.id));
    await tx.update(billingStatements).set({ periodStart: today, periodEnd: end }).where(eq(billingStatements.id, st.id));
    await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.activated", entity: "subscription", entityId: sub.id, after: { periodStart: today, periodEnd: end } }, tx);
    await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "ACTIVE" }, tx);
    await subscriptionChanged(sub.organizationId, sub.id, tx);
    activatedQueue.push([sub.organizationId, sub.id]);
  } else if (st.kind === "RENEWAL" && (sub.status === "PAST_DUE" || sub.status === "SUSPENDED")) {
    await rollPeriod(sub.id, tx);
  } else if (st.kind === "CHANGE") {
    await applyPaidChange(st.id, tx);
    await activatePaidAddOns(st.id, tx);
  }
}

/** Activation side effects (provisioning) run after commit. */
export const activatedQueue: [string, string][] = [];

/** Start the next period: apply scheduled changes and the paid renewal (activity 5.4). */
export async function rollPeriod(subscriptionId: string, tx: DBorTx) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (!sub?.currentPeriodEnd) return;
  const start = sub.currentPeriodEnd;
  const cycle = sub.scheduledCycle ?? sub.cycle;
  const planId = sub.scheduledPlanId ?? sub.planId;
  const end = periodEnd(start, cycle, sub.anchorDay);
  if (sub.scheduledPlanId || sub.scheduledCycle || sub.scheduledAddOnIds) {
    const renewal = await renewalStatement(sub.id, start, tx);
    const priceIds = renewal ? (await tx.select().from(statementLines).where(eq(statementLines.statementId, renewal.id))).map((l) => l.priceId).filter(Boolean) : [];
    await tx.update(subscriptionItems).set({ active: false }).where(eq(subscriptionItems.subscriptionId, sub.id));
    const ps = priceIds.length ? await tx.select().from(prices).where(inArray(prices.id, priceIds as string[])) : [];
    for (const p of ps) await tx.insert(subscriptionItems).values({ organizationId: sub.organizationId, subscriptionId: sub.id, kind: p.planId ? "PLAN" : "ADD_ON", priceId: p.id, addOnId: p.addOnId });
  }
  await tx
    .update(subscriptions)
    .set({ status: "ACTIVE", planId, cycle, currentPeriodStart: start, currentPeriodEnd: end, scheduledPlanId: null, scheduledCycle: null, scheduledAddOnIds: null, pastDueSince: null, suspendedAt: null, graceUntil: null })
    .where(eq(subscriptions.id, sub.id));
  await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.renewed", entity: "subscription", entityId: sub.id, after: { periodStart: start, periodEnd: end, planId } }, tx);
  await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "ACTIVE", planId }, tx);
  await subscriptionChanged(sub.organizationId, sub.id, tx);
}

export async function renewalStatement(subscriptionId: string, periodStart: string, tx: DBorTx = db()) {
  const [st] = await tx
    .select()
    .from(billingStatements)
    .where(and(eq(billingStatements.subscriptionId, subscriptionId), eq(billingStatements.kind, "RENEWAL"), eq(billingStatements.periodStart, periodStart), inArray(billingStatements.status, ["OPEN", "PARTIALLY_PAID", "PAID"])));
  return st ?? null;
}

/** UC-06 step 1: renewal statement 7 days before the period ends, with scheduled changes applied. */
export async function createRenewal(subscriptionId: string) {
  return db().transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    if (!sub || sub.status !== "ACTIVE" || sub.cancelAtPeriodEnd || !sub.currentPeriodEnd) return null;
    if (await renewalStatement(sub.id, sub.currentPeriodEnd, tx)) return null;
    const cycle = sub.scheduledCycle ?? sub.cycle;
    const { plan, product } = await planAndProduct(sub.scheduledPlanId ?? sub.planId, tx);
    const start = sub.currentPeriodEnd;
    const end = periodEnd(start, cycle, sub.anchorDay);
    const price = await priceFor({ planId: plan.id }, cycle, start, tx);
    if (!price) throw new BillingError(`No renewal price for ${plan.name}.`);
    const lines: LineInput[] = [{ kind: "PLAN", description: `${product.name} ${plan.name}, ${start} to ${addDays(end, -1)}`, unitCentavos: price.amountCentavos, servicePeriodStart: start, servicePeriodEnd: addDays(end, -1), priceId: price.id }];
    const currentAddOns = (await tx.select().from(subscriptionItems).where(and(eq(subscriptionItems.subscriptionId, sub.id), eq(subscriptionItems.kind, "ADD_ON"), eq(subscriptionItems.active, true)))).map((i) => i.addOnId!).filter(Boolean);
    const addOnIds = sub.scheduledAddOnIds ?? currentAddOns;
    for (const a of addOnIds.length ? await tx.select().from(addOns).where(inArray(addOns.id, addOnIds)) : []) {
      const ap = await priceFor({ addOnId: a.id }, cycle, start, tx);
      if (ap) lines.push({ kind: "ADD_ON", description: `${a.name}, ${start} to ${addDays(end, -1)}`, unitCentavos: ap.amountCentavos, servicePeriodStart: start, servicePeriodEnd: addDays(end, -1), priceId: ap.id });
    }
    const st = await createStatement({ organizationId: sub.organizationId, sellerProfileId: product.sellerProfileId, subscriptionId: sub.id, kind: "RENEWAL", issueDate: manilaDate(), dueDate: start, periodStart: start, periodEnd: end, lines }, tx);
    await mailStatement(st.id, tx);
    return st;
  });
}

/** FR-18: upgrade now with a prorated charge; downgrade or cycle change at renewal. */
export async function changePlan(ctx: OrgContext, subscriptionId: string, input: { planId: string; cycle?: Cycle }) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  return db().transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(inOrg(ctx, subscriptions.organizationId, eq(subscriptions.id, subscriptionId)));
    if (!sub || sub.status !== "ACTIVE" || !sub.currentPeriodStart || !sub.currentPeriodEnd) throw new BillingError("Only an active subscription can change plan.");
    const cur = await planAndProduct(sub.planId, tx);
    const next = await planAndProduct(input.planId, tx);
    if (next.product.id !== cur.product.id) throw new BillingError("That plan belongs to another product.");
    const cycle = input.cycle ?? sub.cycle;
    if (next.plan.rank > cur.plan.rank && cycle === sub.cycle) {
      const [item] = await tx
        .select({ p: prices })
        .from(subscriptionItems)
        .innerJoin(prices, eq(prices.id, subscriptionItems.priceId))
        .where(and(eq(subscriptionItems.subscriptionId, sub.id), eq(subscriptionItems.kind, "PLAN"), eq(subscriptionItems.active, true)));
      const oldPrice = item?.p ?? (await priceFor({ planId: cur.plan.id }, sub.cycle, manilaDate(), tx))!;
      const newPrice = await priceFor({ planId: next.plan.id }, cycle, manilaDate(), tx);
      if (!newPrice) throw new BillingError("That plan has no price for this billing cycle.");
      const today = manilaDate();
      const remaining = Math.max(0, daysBetween(today, sub.currentPeriodEnd));
      const total = Math.max(1, daysBetween(sub.currentPeriodStart, sub.currentPeriodEnd));
      const amount = mulDiv(newPrice.amountCentavos - oldPrice.amountCentavos, remaining, total);
      const setupDiff = Math.max(0, newPrice.setupFeeCentavos - oldPrice.setupFeeCentavos);
      const lines: LineInput[] = [
        { kind: "PRORATION", description: `Upgrade to ${next.plan.name} for the ${remaining} days left in this period (${formatPHP(newPrice.amountCentavos - oldPrice.amountCentavos)} x ${remaining}/${total})`, unitCentavos: amount, servicePeriodStart: today, servicePeriodEnd: addDays(sub.currentPeriodEnd, -1), priceId: newPrice.id },
      ];
      if (setupDiff > 0) lines.push({ kind: "SETUP_FEE", description: `Setup difference, ${cur.plan.name} to ${next.plan.name}`, unitCentavos: setupDiff, priceId: newPrice.id });
      const st = await createStatement({ organizationId: ctx.organizationId, sellerProfileId: cur.product.sellerProfileId, subscriptionId: sub.id, kind: "CHANGE", issueDate: today, dueDate: today, lines, actorId: ctx.actorId }, tx);
      await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "subscription.upgrade_started", entity: "subscription", entityId: sub.id, after: { to: next.plan.code, statement: st.number }, ip: ctx.ip }, tx);
      if (st.status === "PAID") await applyPaidChange(st.id, tx);
      return { mode: "upgrade" as const, statement: st };
    }
    await tx.update(subscriptions).set({ scheduledPlanId: next.plan.id, scheduledCycle: cycle }).where(eq(subscriptions.id, sub.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "subscription.change_scheduled", entity: "subscription", entityId: sub.id, after: { to: next.plan.code, cycle, on: sub.currentPeriodEnd }, ip: ctx.ip }, tx);
    return { mode: "scheduled" as const, on: sub.currentPeriodEnd };
  });
}

/** Upgrade paid: switch the plan now; the next renewal bills the new plan. */
async function applyPaidChange(statementId: string, tx: DBorTx) {
  const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, statementId));
  const lines = await tx.select().from(statementLines).where(eq(statementLines.statementId, statementId));
  const priceId = lines.find((l) => l.kind === "PRORATION")?.priceId;
  if (!priceId || !st?.subscriptionId) return;
  const [p] = await tx.select().from(prices).where(eq(prices.id, priceId));
  if (!p?.planId) return;
  await tx.update(subscriptionItems).set({ active: false }).where(and(eq(subscriptionItems.subscriptionId, st.subscriptionId), eq(subscriptionItems.kind, "PLAN")));
  await tx.insert(subscriptionItems).values({ organizationId: st.organizationId, subscriptionId: st.subscriptionId, kind: "PLAN", priceId: p.id });
  await tx.update(subscriptions).set({ planId: p.planId, scheduledPlanId: null }).where(eq(subscriptions.id, st.subscriptionId));
  await audit({ organizationId: st.organizationId, actorKind: "system", action: "subscription.upgraded", entity: "subscription", entityId: st.subscriptionId, after: { planId: p.planId } }, tx);
  await publish("billing.subscription.changed", st.organizationId, { subscriptionId: st.subscriptionId, status: "ACTIVE", planId: p.planId }, tx);
  await subscriptionChanged(st.organizationId, st.subscriptionId, tx);
}

/** Add-ons: added now with a prorated charge; removed at the end of the period. */
export async function setAddOns(ctx: OrgContext, subscriptionId: string, addOnIds: string[]) {
  await requireRole(ctx, ["OWNER", "BILLING"]);
  return db().transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(inOrg(ctx, subscriptions.organizationId, eq(subscriptions.id, subscriptionId)));
    if (!sub || sub.status !== "ACTIVE" || !sub.currentPeriodStart || !sub.currentPeriodEnd) throw new BillingError("Only an active subscription can change add-ons.");
    const { plan, product } = await planAndProduct(sub.planId, tx);
    const current = (await tx.select().from(subscriptionItems).where(and(eq(subscriptionItems.subscriptionId, sub.id), eq(subscriptionItems.kind, "ADD_ON"), eq(subscriptionItems.active, true)))).map((i) => i.addOnId!);
    const added = await addOnRows(addOnIds.filter((a) => !current.includes(a)), product.id, plan.rank, tx);
    const removed = current.filter((a) => !addOnIds.includes(a));
    let statement = null;
    if (added.length) {
      const today = manilaDate();
      const remaining = Math.max(0, daysBetween(today, sub.currentPeriodEnd));
      const total = Math.max(1, daysBetween(sub.currentPeriodStart, sub.currentPeriodEnd));
      const lines: LineInput[] = [];
      for (const a of added) {
        const ap = await priceFor({ addOnId: a.id }, sub.cycle, today, tx);
        if (!ap) throw new BillingError(`${a.name} has no price.`);
        lines.push({ kind: "ADD_ON", description: `${a.name} for the ${remaining} days left in this period`, unitCentavos: mulDiv(ap.amountCentavos, remaining, total), servicePeriodStart: today, servicePeriodEnd: addDays(sub.currentPeriodEnd, -1), priceId: ap.id });
        await tx.insert(subscriptionItems).values({ organizationId: sub.organizationId, subscriptionId: sub.id, kind: "ADD_ON", priceId: ap.id, addOnId: a.id, active: false });
      }
      statement = await createStatement({ organizationId: ctx.organizationId, sellerProfileId: product.sellerProfileId, subscriptionId: sub.id, kind: "CHANGE", issueDate: today, dueDate: today, lines, actorId: ctx.actorId }, tx);
    }
    if (removed.length) await tx.update(subscriptions).set({ scheduledAddOnIds: addOnIds }).where(eq(subscriptions.id, sub.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: "subscription.add_ons_changed", entity: "subscription", entityId: sub.id, after: { added: added.map((a) => a.code), removedAtRenewal: removed }, ip: ctx.ip }, tx);
    return { statement };
  });
}

/** Paid add-on change: turn on the add-ons bought on that statement. */
export async function activatePaidAddOns(statementId: string, tx: DBorTx) {
  const [st] = await tx.select().from(billingStatements).where(eq(billingStatements.id, statementId));
  if (!st?.subscriptionId || st.kind !== "CHANGE") return;
  const lines = await tx.select().from(statementLines).where(and(eq(statementLines.statementId, statementId), eq(statementLines.kind, "ADD_ON")));
  for (const l of lines) if (l.priceId) await tx.update(subscriptionItems).set({ active: true }).where(and(eq(subscriptionItems.subscriptionId, st.subscriptionId), eq(subscriptionItems.priceId, l.priceId)));
  if (lines.length) await subscriptionChanged(st.organizationId, st.subscriptionId, tx);
}

/** FR-18: cancel at the end of the paid period; reactivate before it ends. */
export async function setCancelAtPeriodEnd(ctx: OrgContext, subscriptionId: string, cancel: boolean) {
  await requireRole(ctx, ["OWNER"]);
  await db().transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(inOrg(ctx, subscriptions.organizationId, eq(subscriptions.id, subscriptionId)));
    if (!sub || !["ACTIVE", "PAST_DUE", "SUSPENDED"].includes(sub.status)) throw new BillingError("This subscription cannot be changed.");
    await tx.update(subscriptions).set({ cancelAtPeriodEnd: cancel }).where(eq(subscriptions.id, sub.id));
    // An open renewal for the next period is withdrawn when cancelling.
    if (cancel && sub.currentPeriodEnd) {
      const r = await renewalStatement(sub.id, sub.currentPeriodEnd, tx);
      if (r && r.status === "OPEN" && r.paidCentavos === 0) await tx.update(billingStatements).set({ status: "VOID", voidReason: "Subscription cancelled at period end" }).where(eq(billingStatements.id, r.id));
    }
    await audit({ organizationId: ctx.organizationId, actorId: ctx.actorId, action: cancel ? "subscription.cancel_requested" : "subscription.cancel_withdrawn", entity: "subscription", entityId: sub.id, ip: ctx.ip }, tx);
    await publish("billing.subscription.changed", ctx.organizationId, { subscriptionId: sub.id, status: sub.status, cancelAtPeriodEnd: cancel }, tx);
  });
}

export async function orgSubscriptions(ctx: OrgContext) {
  return db()
    .select({ sub: subscriptions, plan: plans, product: products })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(products, eq(products.id, subscriptions.productId))
    .where(inOrg(ctx, subscriptions.organizationId))
    .orderBy(desc(subscriptions.createdAt));
}

export async function orgStatements(ctx: OrgContext) {
  return db().select().from(billingStatements).where(inOrg(ctx, billingStatements.organizationId)).orderBy(desc(billingStatements.issueDate), desc(billingStatements.number));
}

/** Owners and Billing members, for billing emails. */
export async function billingRecipients(organizationId: string, tx: DBorTx = db()) {
  const rows = await tx
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "ACTIVE"), inArray(memberships.role, ["OWNER", "BILLING"])));
  return rows.map((r) => r.email);
}
