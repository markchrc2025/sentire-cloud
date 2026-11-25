"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/server/http/session";
import { decideRequest } from "@/server/paywall/service";

export async function decideAction(fd: FormData) {
  const { ctx } = await requireOrg();
  const approve = fd.get("approve") === "1";
  let to: string;
  try {
    const r = await decideRequest(ctx, String(fd.get("id")), approve, String(fd.get("reason") ?? "") || undefined);
    to = approve
      ? `/upgrade?${new URLSearchParams({ org: ctx.organizationId, feature: r.featureKey, app: r.appId ?? "ledger", return: r.returnUrl ?? "" })}`
      : "/org/requests?ok=Declined.+We+told+the+requester.";
  } catch (e) {
    to = `/org/requests?error=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(to);
}
