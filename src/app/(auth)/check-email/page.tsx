import { AuthShell, Messages, str, type SP } from "@/components/ui";
import { resendAction } from "../actions";

export const metadata = { title: "Check your email" };

export default async function CheckEmail({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const email = str(sp.email) ?? "";
  return (
    <AuthShell title="Check your email" subtitle={<>We sent a confirmation link to <strong>{email || "your email"}</strong>. It works for 24 hours.</>}>
      <Messages sp={sp} />
      <form action={resendAction}>
        <input type="hidden" name="email" value={email} />
        <button className="btn-secondary w-full">Send a new link</button>
      </form>
    </AuthShell>
  );
}
