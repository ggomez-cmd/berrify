import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractInvoiceFromText } from "./invoice-extract";
import { extractPdfTextFromDataUrl } from "./invoice-pdf";
import { suggestInvoicePayment } from "./invoice-payment";
import type { QbAccountRow } from "./qb-account-match";

// Vite's `?url` import yields a site-root path; pdf.js's Node fake worker needs a file URL.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", async () => {
  const { resolve: resolvePath } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  return { default: pathToFileURL(resolvePath("node_modules/pdfjs-dist/build/pdf.worker.min.mjs")).href };
});

/** Real Sam's Club curbside order PDF from the operator: order 800000074412226, $390.13. */
const SAMS_CLUB_REAL_PDF = resolve(__dirname, "__fixtures__/sams-club-receipt-real.pdf");

function pdfDataUrl(path: string): string {
  return `data:application/pdf;base64,${readFileSync(path).toString("base64")}`;
}

const accounts: QbAccountRow[] = [
  ["cc-1", "23300", "VISA x4007", "CreditCard"],
  ["cc-2", "23400", "AMEX - 02000", "CreditCard"],
  ["cc-3", "23600", "Amex-12007", "CreditCard"],
  ["bank-1", "10000", "BPPR - 016374290", "Bank"],
].map(([list_id, account_number, full_name, account_type]) => ({
  connection_id: "conn-semilla",
  list_id: list_id!,
  full_name: full_name!,
  account_number,
  account_type,
  is_active: true,
}));

describe("real Sam's Club receipt PDF through pdf.js", () => {
  it("keeps the receipt's visual lines", async () => {
    const lines = (await extractPdfTextFromDataUrl(pdfDataUrl(SAMS_CLUB_REAL_PDF))).split("\n");
    expect(lines).toContain("Total $390.13");
    expect(lines).toContain("Ending in 8670 $390.13");
    expect(lines).toContain("Don Q Cristal Puerto Rican Rum 1 L Qty 5 $79.85");
  });

  it("rolls the beverage lines and PR tax into expenses", async () => {
    const text = await extractPdfTextFromDataUrl(pdfDataUrl(SAMS_CLUB_REAL_PDF));
    const extracted = extractInvoiceFromText(text);
    expect(extracted.invoice_number).toBe("800000074412226");
    expect(extracted.total).toBe(390.13);
    expect(extracted.expenses.map((line) => [line.account, line.amount])).toEqual([
      ["60025 · Sales tax expense", 40.24],
      ["50010 · Beverage Purchases", 349.89],
    ]);
  });

  it("books the Ending in 8670 payment to the bank as check x8670", async () => {
    const text = await extractPdfTextFromDataUrl(pdfDataUrl(SAMS_CLUB_REAL_PDF));
    expect(suggestInvoicePayment({ ocrText: text, total: 390.13, accounts }).payment).toEqual({
      kind: "check",
      account: "10000 · BPPR - 016374290",
      checkNumber: "x8670",
    });
  });
});
