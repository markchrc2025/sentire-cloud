import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { htmlToPdf, statementHtml } from "@/server/billing/render";

const st = {
  number: "SC-2026-000001", issueDate: "2026-11-25", dueDate: "2026-11-25", status: "OPEN", kind: "INITIAL", periodStart: null, periodEnd: null,
  subtotalCentavos: 2288000, taxCentavos: 0, totalCentavos: 2288000, paidCentavos: 0, withheldCentavos: 0, creditedCentavos: 0,
  sellerSnapshot: { registeredName: "Sentire Solutions OPC", tin: "123456789", branchCode: "00000", address: "Marikina City", taxStatus: "NON_VAT", confirmed: true },
  buyerSnapshot: { registeredName: "Dela Cruz <Trading>", tin: "987654321", branchCode: "00000", address: "Pasig" },
  birInvoiceNumber: null,
};

describe("billing statement document", () => {
  it("says it is not a BIR invoice, shows non-VAT status and escapes text", () => {
    const html = statementHtml(st, [{ description: "Sentire Ledger Solo", quantity: 1, unitCentavos: 2288000, amountCentavos: 2288000 }]);
    expect(html).toContain("not a BIR invoice");
    expect(html).toContain("Non-VAT registered");
    expect(html).toContain("Dela Cruz &lt;Trading&gt;");
    expect(html).not.toMatch(/<h1>Invoice/i);
    expect(html).toContain("PHP 22,880.00");
  });
  it.skipIf(!existsSync(process.env.CHROME_PATH ?? "/usr/bin/google-chrome"))("prints to PDF", async () => {
    const pdf = await htmlToPdf(statementHtml(st, []));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
