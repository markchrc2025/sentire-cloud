import { AuthShell, Field, Messages, str, type SP } from "@/components/ui";
import { resetAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Choose a new password" subtitle="This signs you out on every device.">
      <Messages sp={sp} />
      <form action={resetAction}>
        <input type="hidden" name="token" value={str(sp.token) ?? ""} />
        <Field label="New password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters." />
        <button className="btn w-full">Save password</button>
      </form>
    </AuthShell>
  );
}
