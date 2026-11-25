import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, Field, Messages, str, type SP } from "@/components/ui";
import { currentSession, safeNext } from "@/server/http/session";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(str(sp.next));
  if (await currentSession()) redirect(next);
  return (
    <AuthShell title="Sign in to Sentire" subtitle="Your Sentire Account works in every Sentire app.">
      <Messages sp={sp} />
      <form action={signInAction}>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" required autoComplete="username" defaultValue={str(sp.email)} />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
        <button className="btn w-full">Sign in</button>
      </form>
      <div className="muted mt-4 flex justify-between text-sm">
        <Link className="underline" href="/forgot">Forgot password?</Link>
        <Link className="underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </div>
    </AuthShell>
  );
}
