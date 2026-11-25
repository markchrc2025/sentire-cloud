import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import type { PaymentProvider } from "./types";

/** Built-in test provider: a hosted page at /pay/test/:ref with Pay and Fail buttons that posts a signed webhook. Staging and tests only. */
export function testSignature(body: string) {
  return createHmac("sha256", `test-provider:${env().SESSION_SECRET}`).update(body).digest("hex");
}

export const testProvider: PaymentProvider = {
  name: "test",
  async createCheckout(req) {
    return { providerRef: `test_${req.sessionId}`, url: `${env().APP_URL}/pay/test/test_${req.sessionId}` };
  },
  async parseWebhook(headers, rawBody) {
    const sig = headers.get("x-test-signature") ?? "";
    if (!safeEqual(sig, testSignature(rawBody))) throw new Error("bad signature");
    const b = JSON.parse(rawBody) as { id: string; type: string; ref: string; amount: number; method?: "CARD" | "GCASH" | "MAYA" };
    return {
      eventId: b.id,
      type: b.type === "paid" ? "payment.paid" : b.type === "failed" ? "payment.failed" : "other",
      providerRef: b.ref,
      amountCentavos: b.amount,
      method: b.method ?? "TEST",
      paymentRef: `pay_${b.id}`,
      raw: b,
    };
  },
};
