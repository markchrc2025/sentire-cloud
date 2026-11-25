import { Messages, type SP } from "@/components/ui";
import { OrgFields } from "@/components/OrgForm";
import { requireOrg } from "@/server/http/session";
import { leaveAction, updateOrgAction } from "../../portal-actions";

export const metadata = { title: "Organization" };

export default async function OrgSettings({ searchParams }: { searchParams: SP }) {
  const { current } = await requireOrg();
  const sp = await searchParams;
  const canEdit = current.role === "OWNER" || current.role === "ADMIN";
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Organization</h1>
      <div className="card mt-6">
        <Messages sp={sp} />
        {current.org.flaggedDuplicateTin ? <p className="mb-4 text-sm text-amber-800">This TIN and branch are also used by another organization. Sentire will check this.</p> : null}
        <form action={updateOrgAction}>
          <fieldset disabled={!canEdit}>
            <OrgFields org={current.org} />
            {canEdit ? <button className="btn">Save</button> : <p className="muted text-sm">Only an Owner or Admin can change these details.</p>}
          </fieldset>
        </form>
      </div>
      <div className="card mt-6">
        <h2 className="font-semibold">Leave this organization</h2>
        <p className="muted mt-1 text-sm">You lose access to its apps. The only Owner must transfer ownership first.</p>
        <form action={leaveAction} className="mt-3"><button className="btn-danger">Leave</button></form>
      </div>
    </div>
  );
}
