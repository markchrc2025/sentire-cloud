import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { loadSession, SESSION_COOKIE } from "@/server/account/sessions";
import { db } from "@/server/db/client";
import { withholdings } from "@/server/db/schema";
import { getFileBody } from "@/server/storage";
import { audit } from "@/server/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await loadSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s || s.user.platformRole === "NONE") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const [w] = await db().select().from(withholdings).where(eq(withholdings.id, id));
  if (!w?.certificateKey) return new Response("Not found", { status: 404 });
  await audit({ organizationId: w.organizationId, actorId: s.user.id, actorKind: "staff", action: "withholding.certificate_viewed", entity: "withholding", entityId: id });
  const body = await getFileBody(w.certificateKey);
  const type = w.certificateName?.endsWith(".pdf") ? "application/pdf" : w.certificateName?.match(/\.png$/i) ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${w.certificateName}"` } });
}
