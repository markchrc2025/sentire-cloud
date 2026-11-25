"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { checkoutSessions } from "@/server/db/schema";
import { handleWebhook } from "@/server/billing/payments";
import { testSignature } from "@/server/billing/providers/test";
import { env } from "@/lib/env";

/** Sends the signed webhook the test provider would send, through the same handler as real providers. */
export async function testPayAction(fd: FormData) {
  if (process.env.NODE_ENV === "production" && process.env.SENTIRE_ENV !== "staging") redirect("/");
  const ref = String(fd.get("ref"));
  const [outcome, method] = String(fd.get("outcome")).split(":");
  const [cs] = await db().select().from(checkoutSessions).where(and(eq(checkoutSessions.provider, "test"), eq(checkoutSessions.providerRef, ref)));
  if (!cs) redirect("/");
  const body = JSON.stringify({ id: randomUUID(), type: outcome, ref, amount: cs.amountCentavos, method });
  await handleWebhook("test", new Headers({ "x-test-signature": testSignature(body) }), body);
  const base = env().APP_URL;
  redirect(outcome === "paid" ? `${base}/org/billing/return?session=${cs.id}` : `${base}/org/billing/statements/${cs.statementId}?error=Payment+failed.+Nothing+was+charged.`);
}
