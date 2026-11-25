import { Field } from "./ui";

type Org = {
  registeredName?: string; tradeName?: string | null; tin?: string; branchCode?: string; address?: string; vatStatus?: string; industry?: string | null; billingEmail?: string; phone?: string | null;
};

export function OrgFields({ org }: { org?: Org }) {
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      <Field label="Registered name (as on BIR Form 2303)" name="registeredName" required defaultValue={org?.registeredName} />
      <Field label="Trade name" name="tradeName" defaultValue={org?.tradeName} />
      <Field label="TIN" name="tin" required defaultValue={org?.tin} placeholder="123-456-789" hint="9 digits; branch code below." />
      <Field label="Branch code" name="branchCode" defaultValue={org?.branchCode ?? "00000"} />
      <div className="sm:col-span-2"><Field label="Registered business address" name="address" required defaultValue={org?.address} /></div>
      <div className="mb-4">
        <label className="label" htmlFor="vatStatus">Tax registration</label>
        <select className="input" id="vatStatus" name="vatStatus" defaultValue={org?.vatStatus ?? "NON_VAT"}>
          <option value="NON_VAT">Non-VAT</option>
          <option value="VAT">VAT-registered</option>
        </select>
      </div>
      <Field label="Industry" name="industry" defaultValue={org?.industry} />
      <Field label="Billing email" name="billingEmail" type="email" required defaultValue={org?.billingEmail} />
      <Field label="Phone" name="phone" defaultValue={org?.phone} />
    </div>
  );
}
