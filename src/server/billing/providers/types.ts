export interface CheckoutRequest {
  sessionId: string; // our checkout_sessions.id, also the idempotency reference
  statementNumber: string;
  description: string;
  amountCentavos: number;
  customerEmail: string;
  customerName: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutCreated {
  providerRef: string;
  url: string;
}

/** A provider event we act on, after the signature or status was checked. */
export interface ProviderPaymentEvent {
  eventId: string;
  type: "payment.paid" | "payment.failed" | "other";
  providerRef: string; // checkout reference
  amountCentavos: number;
  method: "CARD" | "GCASH" | "MAYA" | "TEST";
  paymentRef: string;
  raw: unknown;
}

export interface PaymentProvider {
  name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutCreated>;
  /** Verify the webhook (signature, or a status lookup for providers without signatures). Throws when not genuine. */
  parseWebhook(headers: Headers, rawBody: string): Promise<ProviderPaymentEvent>;
}
