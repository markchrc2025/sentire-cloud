import { redirect } from "next/navigation";
import { AuthShell, Field, Messages, str, type SP } from "@/components/ui";
import { currentSession, safeNext } from "@/server/http/session";
import { passkeyAuthenticationOptions } from "@/server/account/passkeys";
import { twoFactorAction } from "../../actions";
import { PasskeySignIn } from "@/components/PasskeyButtons";

export const metadata = { title: "Two-factor sign-in" };

export default async function TwoFactor({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(str(sp.next));
  const s = await currentSession({ allowPending: true });
  if (!s?.session.pendingMfa) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const options = await passkeyAuthenticationOptions(s.user.id);
  return (
    <AuthShell title="Confirm it is you" subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
      <Messages sp={sp} />
      {options ? <PasskeySignIn options={JSON.parse(JSON.stringify(options))} next={next} action={twoFactorAction} /> : null}
      <form action={twoFactorAction}>
        <input type="hidden" name="next" value={next} />
        <Field label="Code" name="code" required autoComplete="one-time-code" />
        <button className="btn w-full">Continue</button>
      </form>
    </AuthShell>
  );
}
