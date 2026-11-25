import { cookies } from "next/headers";
import { loadSession, SESSION_COOKIE } from "@/server/account/sessions";
import { myOrganizations } from "@/server/account/orgs";
import { statementWithLines } from "@/server/billing/statements";
import { htmlToPdf, statementHtml } from "@/server/billing/render";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response("Sign in first", { status: 401 });
  const orgs = await myOrganizations(s.user.id);
  for (const o of orgs) {
    if (!["OWNER", "ADMIN", "BILLING"].includes(o.role)) continue;
    const found = await statementWithLines(o.org.id, id);
    if (found) {
      const pdf = await htmlToPdf(statementHtml(found.st as never, found.lines));
      return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${found.st.number}.pdf"` } });
    }
  }
  return new Response("Not found", { status: 404 });
}
