import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Brand />
      <h1 className="mt-10 text-3xl font-semibold">One account for every Sentire app</h1>
      <p className="muted mt-3">
        Sentire Cloud holds your Sentire Account, your company and its people, your subscriptions and billing, and the connections between
        Sentire Ledger, Payroll, Projects and the rest.
      </p>
      <div className="mt-8 flex gap-3">
        <Link className="btn" href="/sign-in">Sign in</Link>
        <Link className="btn-secondary" href="/sign-up">Create an account</Link>
        <Link className="btn-secondary" href="/status">Service status</Link>
      </div>
    </main>
  );
}
