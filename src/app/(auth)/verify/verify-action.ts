"use server";

import { redirect } from "next/navigation";
import { verifyEmail } from "@/server/account/service";
import { clientIp, deviceLabel, setSessionCookie } from "@/server/http/session";

export async function verifyAction(fd: FormData) {
  const r = await verifyEmail(String(fd.get("token") ?? ""), await clientIp(), await deviceLabel());
  if (!r) redirect("/verify?error=expired");
  await setSessionCookie(r.token);
  redirect("/onboarding");
}
