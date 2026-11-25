import { Brand } from "@/components/Brand";

export const metadata = { title: "Privacy Notice" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Brand />
      <article className="card mt-6 space-y-3 text-sm leading-6">
        <h1 className="text-xl font-semibold">Privacy Notice</h1>
        <p className="muted">Draft for review by Sentire before launch. Version 0.1, 25 November 2026.</p>
        <p>Sentire Solutions is the personal information controller for your Sentire Account and billing data, and a processor for the business data your organization keeps in the Sentire apps, under the Data Privacy Act of 2012 (RA 10173).</p>
        <p>We collect your name, email, sign-in records and the details of your organization needed to provide the service and to bill for it. Marketing email is sent only if you ask for it, and you can stop it at any time on your account page.</p>
        <p>You can ask for access to your data, a correction, or deletion from your account page or by emailing privacy@sentire.solutions. Billing records are kept as long as Philippine tax rules require, even after an account is deleted.</p>
        <p>If a personal data breach affects you, we will tell you and the National Privacy Commission within 72 hours where the law requires it.</p>
      </article>
    </main>
  );
}
