import Link from "next/link";
import { Messages, type SP } from "@/components/ui";
import { requireSession } from "@/server/http/session";
import { deletionAction, privacyAction } from "../portal-actions";

export const metadata = { title: "Your account" };

export default async function Account({ searchParams }: { searchParams: SP }) {
  const s = await requireSession("/account");
  const sp = await searchParams;
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Your Sentire Account</h1>
      <div className="mt-4"><Messages sp={sp} /></div>
      <div className="card">
        <p><strong>{s.user.name}</strong></p>
        <p className="muted text-sm">{s.user.email}</p>
        <Link className="btn-secondary mt-4" href="/account/security">Password, two-factor and sessions</Link>
      </div>
      <div className="card mt-6">
        <h2 className="font-semibold">Privacy</h2>
        <form action={privacyAction} className="mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="marketing" defaultChecked={!!s.user.marketingConsentAt} /> Send me product news and offers by email
          </label>
          <button className="btn-secondary mt-3">Save</button>
        </form>
        <p className="muted mt-4 text-sm">You can ask for a copy of your data, a correction, or deletion under the Data Privacy Act. See the <Link className="underline" href="/legal/privacy">Privacy Notice</Link>.</p>
        {s.user.deletionRequestedAt ? (
          <p className="mt-3 text-sm">Deletion requested on {s.user.deletionRequestedAt.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}.</p>
        ) : (
          <form action={deletionAction} className="mt-3"><button className="btn-danger">Ask to delete my account</button></form>
        )}
      </div>
    </div>
  );
}
