import "server-only";
import { notFound, redirect } from "next/navigation";
import { mustSetUpSecondFactor, requireSession } from "../http/session";

/** Sentire staff only (Platform Admin; Support is read-only). */
export async function requireStaff(write = false) {
  const s = await requireSession("/admin");
  if (s.user.platformRole === "NONE") notFound();
  if (write && s.user.platformRole !== "PLATFORM_ADMIN") notFound();
  // Staff reach the console only with a second factor set up (FR-02).
  if (await mustSetUpSecondFactor(s)) redirect("/account/security?required=1");
  return s;
}
