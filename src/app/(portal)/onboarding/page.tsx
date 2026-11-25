import { Messages, type SP } from "@/components/ui";
import { OrgFields } from "@/components/OrgForm";
import { requireSession } from "@/server/http/session";
import { createOrgAction } from "../portal-actions";

export const metadata = { title: "Set up your organization" };

export default async function Onboarding({ searchParams }: { searchParams: SP }) {
  const s = await requireSession("/onboarding");
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Set up your organization</h1>
      <p className="muted mt-1">Hi {s.user.name}. Tell us about the company that will use Sentire. You can change this later.</p>
      <div className="card mt-6">
        <Messages sp={sp} />
        <form action={createOrgAction}>
          <OrgFields org={{ billingEmail: s.user.email }} />
          <button className="btn">Create organization</button>
        </form>
      </div>
      <p className="muted mt-4 text-sm">Joining a company that already uses Sentire? Ask its Owner to invite {s.user.email}.</p>
    </div>
  );
}
