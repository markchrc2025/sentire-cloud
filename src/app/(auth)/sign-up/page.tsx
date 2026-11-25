import Link from "next/link";
import { AuthShell, Field, Messages, str, type SP } from "@/components/ui";
import { signUpAction } from "../actions";

export const metadata = { title: "Create your Sentire Account" };

export default async function SignUp({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Create your Sentire Account" subtitle="One account for every Sentire app.">
      <Messages sp={sp} />
      <form action={signUpAction}>
        <input type="hidden" name="next" value={str(sp.next) ?? ""} />
        <Field label="Full name" name="name" required autoComplete="name" defaultValue={str(sp.name)} />
        <Field label="Work email" name="email" type="email" required autoComplete="email" defaultValue={str(sp.email)} />
        <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters. We check it against known data breaches." />
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" required className="mt-1" />
          <span>I accept the <Link className="underline" href="/legal/terms">Terms of Service</Link> and the <Link className="underline" href="/legal/privacy">Privacy Notice</Link>.</span>
        </label>
        <label className="mb-5 flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketing" className="mt-1" />
          <span>Send me product news and offers by email (optional).</span>
        </label>
        <button className="btn w-full">Create account</button>
      </form>
      <p className="muted mt-4 text-sm">Already have an account? <Link className="underline" href={`/sign-in${sp.next ? `?next=${encodeURIComponent(String(sp.next))}` : ""}`}>Sign in</Link></p>
    </AuthShell>
  );
}
