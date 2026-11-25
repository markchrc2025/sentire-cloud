import { Brand } from "@/components/Brand";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Brand />
      <article className="card mt-6 space-y-3 text-sm leading-6">
        <h1 className="text-xl font-semibold">Terms of Service</h1>
        <p className="muted">Draft for review by Sentire before launch. Version 0.1, 25 November 2026.</p>
        <p>Sentire Solutions provides Sentire Cloud and the Sentire apps as subscription software. By creating an account you agree to use them lawfully and to keep your sign-in details secret.</p>
        <p>Subscriptions renew at the end of each paid period until cancelled. Cancellations take effect at the end of the paid period. If a payment is not made, access becomes read-only after 8 days and the subscription is cancelled after 30 days; your data can be exported for 30 days after cancellation.</p>
        <p>Your business data stays yours. Sentire processes it only to provide the service and as the Privacy Notice describes.</p>
        <p>Billing statements from Sentire Cloud are not BIR invoices; the invoice for each payment is issued separately by Sentire.</p>
      </article>
    </main>
  );
}
