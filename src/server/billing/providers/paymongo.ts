import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import type { PaymentProvider } from "./types";

/**
 * PayMongo Checkout Sessions and webhooks.
 * Not yet exercised against the sandbox: confirm in the Phase 2 spike (task 2.1) once keys are in Dokploy.
 */
const API = "https://api.paymongo.com/v1";

function auth() {
  const k = process.env.PAYMONGO_SECRET_KEY;
  if (!k) throw new Error("PAYMONGO_SECRET_KEY is not set");
  return "Basic " + Buffer.from(`${k}:`).toString("base64");
}

export const paymongoProvider: PaymentProvider = {
  name: "paymongo",
  async createCheckout(req) {
    const res = await fetch(`${API}/checkout_sessions`, {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ name: req.description, quantity: 1, amount: req.amountCentavos, currency: "PHP" }],
            payment_method_types: ["card", "gcash", "paymaya"],
            reference_number: req.sessionId,
            description: `Billing statement ${req.statementNumber}`,
            billing: { name: req.customerName, email: req.customerEmail },
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            success_url: req.successUrl,
            cancel_url: req.cancelUrl,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json()) as { data?: { id: string; attributes: { checkout_url: string } }; errors?: { detail: string }[] };
    if (!res.ok || !body.data) throw new Error(`PayMongo: ${body.errors?.[0]?.detail ?? res.status}`);
    return { providerRef: body.data.id, url: body.data.attributes.checkout_url };
  },
  async parseWebhook(headers, rawBody) {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!secret) throw new Error("PAYMONGO_WEBHOOK_SECRET is not set");
    const header = headers.get("paymongo-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
    const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
    const given = parts.li || parts.te || "";
    if (!parts.t || !given || !safeEqual(given, expected)) throw new Error("bad signature");
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new Error("stale webhook");
    const evt = JSON.parse(rawBody) as {
      data: { id: string; attributes: { type: string; data: { id: string; attributes: { payments?: { id: string; attributes: { amount: number; source?: { type?: string } } }[] } } } };
    };
    const a = evt.data.attributes;
    const pay = a.data.attributes.payments?.[0];
    const src = pay?.attributes.source?.type;
    return {
      eventId: evt.data.id,
      type: a.type === "checkout_session.payment.paid" ? "payment.paid" : "other",
      providerRef: a.data.id,
      amountCentavos: pay?.attributes.amount ?? 0,
      method: src === "gcash" ? "GCASH" : src === "paymaya" ? "MAYA" : "CARD",
      paymentRef: pay?.id ?? a.data.id,
      raw: evt,
    };
  },
};
