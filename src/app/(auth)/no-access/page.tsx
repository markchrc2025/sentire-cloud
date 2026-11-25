import Link from "next/link";
import { AuthShell, Notice, str, type SP } from "@/components/ui";

export const metadata = { title: "No access" };

export default async function NoAccess({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const reason = str(sp.reason);
  const app = str(sp.app);
  const text =
    reason === "subscription"
      ? "Your organization's subscription for this app is not active. Ask your Owner to check the billing page."
      : reason === "expired"
        ? "The sign-in request expired. Go back to the app and try again."
        : `You don't have access to ${app ? `Sentire ${app[0]!.toUpperCase()}${app.slice(1)}` : "this app"}. Ask your organization's Owner to give you access.`;
  return (
    <AuthShell title="You can't open this app yet">
      <Notice kind="error">{text}</Notice>
      <Link className="btn" href="/org">Go to Sentire Cloud</Link>
    </AuthShell>
  );
}
