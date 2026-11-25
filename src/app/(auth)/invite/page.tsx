import Link from "next/link";
import { AuthShell, Messages, Notice, str, type SP } from "@/components/ui";
import { findInvitation } from "@/server/account/orgs";
import { currentSession } from "@/server/http/session";
import { acceptInviteAction } from "../actions";

export const metadata = { title: "Invitation" };

export default async function Invite({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const token = str(sp.token) ?? "";
  const found = token ? await findInvitation(token) : null;
  if (!found || found.inv.status !== "PENDING") {
    return (
      <AuthShell title="This invitation is no longer valid">
        <Notice kind="error">It expired or was withdrawn. Ask the person who invited you to send a new one.</Notice>
      </AuthShell>
    );
  }
  const s = await currentSession();
  const orgName = found.org.tradeName ?? found.org.registeredName;
  const next = encodeURIComponent(`/invite?token=${token}`);
  return (
    <AuthShell title={`Join ${orgName}`} subtitle={<>Invitation for <strong>{found.inv.email}</strong> as {found.inv.role.toLowerCase()}.</>}>
      <Messages sp={sp} />
      {s ? (
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <p className="muted mb-4 text-sm">Signed in as {s.user.email}.</p>
          <button className="btn w-full">Accept invitation</button>
        </form>
      ) : (
        <div className="flex gap-3">
          <Link className="btn" href={`/sign-in?next=${next}&email=${encodeURIComponent(found.inv.email)}`}>Sign in to accept</Link>
          <Link className="btn-secondary" href={`/sign-up?next=${next}&email=${encodeURIComponent(found.inv.email)}`}>Create an account</Link>
        </div>
      )}
    </AuthShell>
  );
}
