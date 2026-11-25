import "server-only";
import { notFound } from "next/navigation";
import { requireSession } from "../http/session";

/** Sentire staff only (Platform Admin; Support is read-only). */
export async function requireStaff(write = false) {
  const s = await requireSession("/admin");
  if (s.user.platformRole === "NONE") notFound();
  if (write && s.user.platformRole !== "PLATFORM_ADMIN") notFound();
  return s;
}
