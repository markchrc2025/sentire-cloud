import { AuthShell, Field, Messages, str, type SP } from "@/components/ui";
import { forgotAction } from "../actions";

export const metadata = { title: "Reset your password" };

export default async function Forgot({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new password.">
      <Messages sp={sp} />
      <form action={forgotAction}>
        <Field label="Email" name="email" type="email" required autoComplete="email" defaultValue={str(sp.email)} />
        <button className="btn w-full">Send reset link</button>
      </form>
    </AuthShell>
  );
}
