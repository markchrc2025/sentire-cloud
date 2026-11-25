import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { audit } from "../audit";

/** BOOTSTRAP_ADMIN_EMAILS (comma separated): those accounts become Platform Admins once they exist. Staff then manage staff. */
export async function bootstrapStaff() {
  const emails = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    const r = await db()
      .update(users)
      .set({ platformRole: "PLATFORM_ADMIN" })
      .where(and(sql`lower(${users.email}) = ${email}`, eq(users.platformRole, "NONE"), eq(users.emailVerified, true)))
      .returning({ id: users.id });
    for (const u of r) await audit({ actorKind: "system", action: "staff.bootstrapped", entity: "user", entityId: u.id, after: { email } });
  }
}
