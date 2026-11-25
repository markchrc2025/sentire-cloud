import type { PaymentProvider } from "./types";

/**
 * Maya Checkout. Maya webhooks are not signed, so the event is confirmed by reading the checkout status back
 * from Maya with the secret key before anything is recorded.
 * Not yet exercised against the sandbox: confirm in the Phase 2 spike (task 2.1) once keys are in Dokploy.
 */
function base() {
  return process.env.MAYA_ENV === "production" ? "https://pg.maya.ph" : "https://pg-sandbox.paymaya.com";
}
function basic(key: string | undefined, name: string) {
  if (!key) throw new Error(`${name} is not set`);
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export const mayaProvider: PaymentProvider = {
  name: "maya",
  async createCheckout(req) {
    const res = await fetch(`${base()}/checkout/v1/checkouts`, {
      method: "POST",
      headers: { Authorization: basic(process.env.MAYA_PUBLIC_KEY, "MAYA_PUBLIC_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({
        totalAmount: { value: req.amountCentavos / 100, currency: "PHP" },
        buyer: { firstName: req.customerName, contact: { email: req.customerEmail } },
        items: [{ name: req.description, quantity: 1, totalAmount: { value: req.amountCentavos / 100 } }],
        redirectUrl: { success: req.successUrl, failure: req.cancelUrl, cancel: req.cancelUrl },
        requestReferenceNumber: req.sessionId,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json()) as { checkoutId?: string; redirectUrl?: string; message?: string };
    if (!res.ok || !body.checkoutId) throw new Error(`Maya: ${body.message ?? res.status}`);
    return { providerRef: body.checkoutId, url: body.redirectUrl! };
  },
  async parseWebhook(_headers, rawBody) {
    const evt = JSON.parse(rawBody) as { id?: string; checkoutId?: string; requestReferenceNumber?: string };
    const checkoutId = evt.checkoutId ?? evt.id;
    if (!checkoutId) throw new Error("no checkout id");
    const res = await fetch(`${base()}/checkout/v1/checkouts/${checkoutId}`, {
      headers: { Authorization: basic(process.env.MAYA_SECRET_KEY, "MAYA_SECRET_KEY") },
      signal: AbortSignal.timeout(15000),
    });
    const c = (await res.json()) as { id: string; paymentStatus?: string; totalAmount?: { value: string | number }; paymentDetails?: { paymentInitiatedAt?: string }; transactionReferenceNumber?: string };
    if (!res.ok) throw new Error("status lookup failed");
    return {
      eventId: `${c.id}:${c.paymentStatus}`,
      type: c.paymentStatus === "PAYMENT_SUCCESS" ? "payment.paid" : c.paymentStatus === "PAYMENT_FAILED" ? "payment.failed" : "other",
      providerRef: c.id,
      amountCentavos: Math.round(Number(c.totalAmount?.value ?? 0) * 100),
      method: "MAYA",
      paymentRef: c.transactionReferenceNumber ?? c.id,
      raw: c,
    };
  },
};
