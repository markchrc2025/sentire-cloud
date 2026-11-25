import { AuthShell, Notice, str, type SP } from "@/components/ui";
import Link from "next/link";
import { verifyAction } from "./verify-action";

export const metadata = { title: "Confirm your email" };

/** Confirmation needs a click (POST) so link scanners in mail systems do not use the token. */
export default async function Verify({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const token = str(sp.token) ?? "";
  if (sp.error) {
    return (
      <AuthShell title="This link has expired">
        <Notice kind="error">The confirmation link is no longer valid.</Notice>
        <Link className="btn" href="/sign-in">Sign in to get a new link</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Confirm your email">
      <form action={verifyAction}>
        <input type="hidden" name="token" value={token} />
        <button className="btn w-full">Confirm my email</button>
      </form>
    </AuthShell>
  );
}
