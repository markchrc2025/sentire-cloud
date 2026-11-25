import { formatPHP } from "@/lib/money";

type Snap = { registeredName: string; tradeName?: string | null; tin: string; branchCode: string; address: string; taxStatus?: string; vatStatus?: string; confirmed?: boolean; bankDetails?: string | null };
type St = {
  number: string; issueDate: string; dueDate: string; status: string; kind: string; periodStart: string | null; periodEnd: string | null;
  subtotalCentavos: number; taxCentavos: number; totalCentavos: number; paidCentavos: number; withheldCentavos: number; creditedCentavos: number;
  sellerSnapshot: unknown; buyerSnapshot: unknown; birInvoiceNumber: string | null;
};
type Line = { description: string; quantity: number; unitCentavos: number; amountCentavos: number };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const tin = (s: Snap) => `${s.tin.slice(0, 3)}-${s.tin.slice(3, 6)}-${s.tin.slice(6, 9)}-${s.branchCode}`;

/** Billing statement as a standalone HTML page (also printed to PDF). Never titled "Invoice" (CR-01). */
export function statementHtml(st: St, lines: Line[]) {
  const seller = st.sellerSnapshot as Snap;
  const buyer = st.buyerSnapshot as Snap;
  const bal = st.totalCentavos - st.paidCentavos - st.withheldCentavos - st.creditedCentavos;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Billing statement ${esc(st.number)}</title>
<style>
@page{size:A4;margin:16mm}body{font-family:Inter,Helvetica,Arial,sans-serif;color:#123a4f;font-size:11pt;margin:0}
h1{font-size:18pt;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:6px 4px;border-bottom:1px solid #dde5e8;text-align:left;vertical-align:top}
td.n,th.n{text-align:right;white-space:nowrap}.muted{color:#4a6572}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}.box{flex:1}
.note{margin-top:20px;padding:10px;border:1px solid #e8b23b;border-radius:8px;font-size:9.5pt}.tot td{border:0}.draft{color:#a15c00;font-weight:600}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>Billing statement</h1><div class="muted">${esc(st.number)}</div></div>
  <div style="text-align:right"><strong>${esc(seller.tradeName ?? seller.registeredName)}</strong><br>${esc(seller.registeredName)}<br>TIN ${esc(tin(seller))}<br>${esc(seller.address)}<br>${seller.taxStatus === "VAT" ? "VAT-registered" : "Non-VAT registered"}</div>
</div>
${seller.confirmed === false ? `<p class="draft">Seller details are not yet confirmed. Test statement.</p>` : ""}
<div class="grid">
  <div class="box"><div class="muted">Bill to</div><strong>${esc(buyer.registeredName)}</strong>${buyer.tradeName ? `<br>${esc(buyer.tradeName)}` : ""}<br>TIN ${esc(tin(buyer))}<br>${esc(buyer.address)}</div>
  <div class="box"><div class="muted">Dates</div>Issued ${esc(st.issueDate)}<br>Due ${esc(st.dueDate)}${st.periodStart ? `<br>Service ${esc(st.periodStart)} to ${esc(st.periodEnd)}` : ""}<br>Status: ${esc(st.status.replace("_", " ").toLowerCase())}</div>
</div>
<table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead><tbody>
${lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${l.quantity}</td><td class="n">${formatPHP(l.unitCentavos)}</td><td class="n">${formatPHP(l.amountCentavos)}</td></tr>`).join("")}
</tbody></table>
<table class="tot" style="width:50%;margin-left:auto">
${st.taxCentavos ? `<tr><td>Amount net of VAT</td><td class="n">${formatPHP(st.subtotalCentavos)}</td></tr><tr><td>VAT (12%)</td><td class="n">${formatPHP(st.taxCentavos)}</td></tr>` : ""}
<tr><td><strong>Total</strong></td><td class="n"><strong>${formatPHP(st.totalCentavos)}</strong></td></tr>
${st.paidCentavos ? `<tr><td>Paid</td><td class="n">-${formatPHP(st.paidCentavos)}</td></tr>` : ""}
${st.withheldCentavos ? `<tr><td>Withheld by you (BIR Form 2307)</td><td class="n">-${formatPHP(st.withheldCentavos)}</td></tr>` : ""}
${st.creditedCentavos ? `<tr><td>Credited</td><td class="n">-${formatPHP(st.creditedCentavos)}</td></tr>` : ""}
<tr><td><strong>Balance</strong></td><td class="n"><strong>${formatPHP(Math.max(0, bal))}</strong></td></tr>
</table>
${seller.bankDetails ? `<p><strong>Bank transfer:</strong> ${esc(seller.bankDetails)}. Put ${esc(st.number)} in the reference.</p>` : ""}
<div class="note">This billing statement is not a BIR invoice. ${st.birInvoiceNumber ? `Invoice number for this payment: <strong>${esc(st.birInvoiceNumber)}</strong>.` : "Sentire issues the invoice when payment is received."}</div>
</body></html>`;
}

/** Print HTML to PDF with the Chromium in the image (CHROME_PATH). */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
  } finally {
    await browser.close();
  }
}
