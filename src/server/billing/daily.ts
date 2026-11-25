import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db/client";
import { billingStatements, checkoutSessions, dunningSteps, organizations, products, subscriptions, withholdings } from "../db/schema";
import { addDays, addMonths, daysBetween, manilaDate } from "@/lib/time";
import { log } from "@/lib/log";
import { audit } from "../audit";
import { publish } from "../hub/publish";
import { sendMail } from "../mail/send";
import { billingMails } from "./mails";
import { createRenewal, renewalStatement, rollPeriod } from "./subscriptions";
import { billingHooks, subscriptionChanged } from "./hooks";

/** UC-04 5a and 3a: unpaid first statements close (online after 24 hours, bank transfer after its due date). */
export async function expirePending(now = new Date()) {
  const today = manilaDate(now);
  const pending = await db().select().from(subscriptions).where(eq(subscriptions.status, "PENDING"));
  for (const sub of pending) {
    const [st] = await db().select().from(billingStatements).where(and(eq(billingStatements.subscriptionId, sub.id), eq(billingStatements.kind, "INITIAL")));
    if (!st || st.status === "PAID") continue;
    const online = st.dueDate === st.issueDate;
    const expired = online ? now.getTime() - sub.createdAt.getTime() > 24 * 3600_000 : today > st.dueDate;
    if (!expired) continue;
    await db().transaction(async (tx) => {
      await tx.update(subscriptions).set({ status: "EXPIRED", endedReason: "First payment not received" }).where(eq(subscriptions.id, sub.id));
      if (st.paidCentavos === 0) await tx.update(billingStatements).set({ status: "VOID", voidReason: "Not paid; subscription request closed" }).where(eq(billingStatements.id, st.id));
      await tx.update(checkoutSessions).set({ status: "EXPIRED" }).where(and(eq(checkoutSessions.statementId, st.id), eq(checkoutSessions.status, "PENDING")));
      await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.expired", entity: "subscription", entityId: sub.id }, tx);
    });
  }
}

/** UC-06 step 1. */
export async function issueRenewals(now = new Date()) {
  const horizon = addDays(manilaDate(now), 7);
  const due = await db().select().from(subscriptions).where(and(eq(subscriptions.status, "ACTIVE"), eq(subscriptions.cancelAtPeriodEnd, false), lte(subscriptions.currentPeriodEnd, horizon)));
  let n = 0;
  for (const s of due) {
    try {
      if (await createRenewal(s.id)) n++;
    } catch (e) {
      log.error({ err: e, subscription: s.id }, "renewal failed");
    }
  }
  return n;
}

/** Period end: roll to the next period if paid, cancel if asked, otherwise Past due (day 0). */
export async function closePeriods(now = new Date()) {
  const today = manilaDate(now);
  const ended = await db().select().from(subscriptions).where(and(eq(subscriptions.status, "ACTIVE"), lte(subscriptions.currentPeriodEnd, today)));
  for (const sub of ended) {
    await db().transaction(async (tx) => {
      if (sub.cancelAtPeriodEnd) {
        await tx.update(subscriptions).set({ status: "CANCELLED", cancelledAt: now, endedReason: "Cancelled by the Owner" }).where(eq(subscriptions.id, sub.id));
        await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.cancelled", entity: "subscription", entityId: sub.id, after: { reason: "period ended after cancel" } }, tx);
        await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "CANCELLED" }, tx);
        await subscriptionChanged(sub.organizationId, sub.id, tx);
        await notifyCancelled(sub.organizationId, sub.productId);
        cancelled.push([sub.organizationId, sub.id]);
        return;
      }
      const r = await renewalStatement(sub.id, sub.currentPeriodEnd!, tx);
      if (r?.status === "PAID") return rollPeriod(sub.id, tx);
      await tx.update(subscriptions).set({ status: "PAST_DUE", pastDueSince: sub.currentPeriodEnd }).where(eq(subscriptions.id, sub.id));
      await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.past_due", entity: "subscription", entityId: sub.id }, tx);
      await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "PAST_DUE" }, tx);
      await subscriptionChanged(sub.organizationId, sub.id, tx);
    });
  }
  await runCancelledHooks();
}

const cancelled: [string, string][] = [];
async function runCancelledHooks() {
  for (const [org, sub] of cancelled.splice(0)) for (const h of billingHooks.onCancelled) await h(org, sub).catch((e) => log.error({ err: e }, "cancel hook failed"));
}

async function notifyCancelled(organizationId: string, productId: string) {
  const [org] = await db().select().from(organizations).where(eq(organizations.id, organizationId));
  const [p] = await db().select().from(products).where(eq(products.id, productId));
  await sendMail({ to: org!.billingEmail, ...billingMails.cancelled(org!, p!.name) });
}

/** UC-07 / activity 5.5: reminders day 0, 3, 7; suspended day 8; cancelled day 30. Staff grace postpones suspension. */
export async function runDunning(now = new Date()) {
  const today = manilaDate(now);
  const subs = await db().select().from(subscriptions).where(inArray(subscriptions.status, ["PAST_DUE", "SUSPENDED"]));
  for (const sub of subs) {
    if (!sub.pastDueSince) continue;
    const st = await renewalStatement(sub.id, sub.pastDueSince);
    if (!st || st.status === "PAID") continue;
    const day = daysBetween(sub.pastDueSince, today);
    const [org] = await db().select().from(organizations).where(eq(organizations.id, sub.organizationId));
    const step = async (offset: number, action: "REMIND" | "SUSPEND" | "CANCEL", fn: () => Promise<void>) => {
      const ins = await db().insert(dunningSteps).values({ subscriptionId: sub.id, statementId: st.id, dayOffset: offset, action }).onConflictDoNothing().returning();
      if (ins.length) await fn();
    };
    for (const d of [0, 3, 7]) if (day >= d && day < 8) await step(d, "REMIND", async () => void (await sendMail({ to: org!.billingEmail, ...billingMails.reminder(st, org!, d) })));
    const graced = sub.graceUntil && sub.graceUntil >= today;
    if (day >= 8 && day < 30 && sub.status === "PAST_DUE" && !graced) {
      await step(8, "SUSPEND", async () => {
        await db().transaction(async (tx) => {
          await tx.update(subscriptions).set({ status: "SUSPENDED", suspendedAt: now }).where(eq(subscriptions.id, sub.id));
          await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.suspended", entity: "subscription", entityId: sub.id }, tx);
          await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "SUSPENDED" }, tx);
          await subscriptionChanged(sub.organizationId, sub.id, tx);
        });
        await sendMail({ to: org!.billingEmail, ...billingMails.suspended(st, org!) });
      });
    }
    if (day >= 30) {
      await step(30, "CANCEL", async () => {
        await db().transaction(async (tx) => {
          await tx.update(subscriptions).set({ status: "CANCELLED", cancelledAt: now, endedReason: "Not paid within 30 days" }).where(eq(subscriptions.id, sub.id));
          await tx.update(billingStatements).set({ status: "VOID", voidReason: "Subscription cancelled for non-payment" }).where(and(eq(billingStatements.id, st.id), eq(billingStatements.paidCentavos, 0)));
          await audit({ organizationId: sub.organizationId, actorKind: "system", action: "subscription.cancelled", entity: "subscription", entityId: sub.id, after: { reason: "non-payment" } }, tx);
          await publish("billing.subscription.changed", sub.organizationId, { subscriptionId: sub.id, status: "CANCELLED" }, tx);
          await subscriptionChanged(sub.organizationId, sub.id, tx);
        });
        await notifyCancelled(sub.organizationId, sub.productId);
        cancelled.push([sub.organizationId, sub.id]);
      });
    }
  }
  await runCancelledHooks();
}

/** UC-08 3a: reminders 30 days after the quarter; staff may bill after 60. */
export async function remindWithholdings(now = new Date()) {
  const today = manilaDate(now);
  const pending = await db().select().from(withholdings).where(and(eq(withholdings.status, "PENDING"), or(isNull(withholdings.remindedAt), lt(withholdings.remindedAt, new Date(now.getTime() - 7 * 86_400_000)))));
  for (const w of pending) {
    const [y, q] = w.quarter.split("-Q").map(Number);
    const qe = addMonths(`${y}-${String((q! - 1) * 3 + 1).padStart(2, "0")}-01`, 3);
    if (daysBetween(qe, today) < 30) continue;
    const [org] = await db().select().from(organizations).where(eq(organizations.id, w.organizationId));
    await sendMail({ to: org!.billingEmail, ...billingMails.withholdingReminder(org!, w.quarter, w.amountCentavos) });
    await db().update(withholdings).set({ remindedAt: now }).where(eq(withholdings.id, w.id));
  }
}

export async function billingDaily(now = new Date()) {
  await expirePending(now);
  await closePeriods(now);
  await runDunning(now);
  await issueRenewals(now);
  await remindWithholdings(now);
}

