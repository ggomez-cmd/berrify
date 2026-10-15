import { describe, expect, it } from "vitest";
import {
  COSTCO_SYNTHETIC_PDF_TEXT,
  SAMS_CLUB_RECEIPT_OCR,
  SUPERMAX_ATH_RECEIPT_OCR,
} from "./invoice-fixtures";
import { extractPdfText, type PdfGetDocument } from "./invoice-pdf";
import {
  detectInvoicePaymentHint,
  draftFromInvoiceColumns,
  invoicePaymentColumns,
  parseInvoicePayment,
  paymentAccountsForKind,
  suggestInvoicePayment,
} from "./invoice-payment";
import type { QbAccountRow } from "./qb-account-match";

function account(listId: string, number: string, name: string, type: string): QbAccountRow {
  return {
    connection_id: "conn-semilla",
    list_id: listId,
    full_name: name,
    account_number: number,
    account_type: type,
    is_active: true,
  };
}

const SEMILLA_ACCOUNTS: QbAccountRow[] = [
  account("cc-1", "23300", "VISA x4007", "CreditCard"),
  account("cc-2", "23400", "AMEX - 02000", "CreditCard"),
  account("cc-3", "23600", "Amex-12007", "CreditCard"),
  account("cc-4", "23405", "Visa BPPR-0657", "CreditCard"),
  account("cc-5", "27200", "AMEX - 1006", "CreditCard"),
  account("bank-1", "10000", "BPPR - 016374290", "Bank"),
  account("exp-1", "50000", "Food Purchases", "CostOfGoodsSold"),
  account("ap-1", "20000", "Accounts Payable", "AccountsPayable"),
];

/** Runs the app's pdf.js text joining on one text item per receipt line. */
async function pdfJsText(receiptText: string): Promise<string> {
  const items = receiptText
    .split("\n")
    .filter((line) => line.trim())
    .map((str) => ({ str }));
  const getDocumentImpl = (() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items }) }),
      destroy: async () => undefined,
    }),
  })) as unknown as PdfGetDocument;
  return extractPdfText(new TextEncoder().encode("%PDF-1.4\n"), { getDocumentImpl });
}

function receipt(paymentLine: string): string {
  return `Costco Wholesale\nKIRKLAND WATER 4.99\nSUBTOTAL 4.99\nTOTAL 4.99\n${paymentLine}\n`;
}

function suggest(paymentLine: string) {
  return suggestInvoicePayment({ ocrText: receipt(paymentLine), total: 4.99, accounts: SEMILLA_ACCOUNTS });
}

describe("detectInvoicePaymentHint", () => {
  it("reads card digits from receipt payment lines", () => {
    expect(detectInvoicePaymentHint("Ending in 8670 $390.13", 390.13)).toEqual({ kind: "card", digits: "8670" });
    expect(detectInvoicePaymentHint("VISA xxxx4007 APPROVED", 1)).toEqual({ kind: "card", digits: "4007" });
    expect(detectInvoicePaymentHint("Card ****4007", 1)).toEqual({ kind: "card", digits: "4007" });
    expect(detectInvoicePaymentHint("VISA x4007", 1)).toEqual({ kind: "card", digits: "4007" });
    expect(detectInvoicePaymentHint("AMEX - 02000", 1)).toEqual({ kind: "card", digits: "02000" });
  });

  it("reads ATH only when the ATH line pays the total or ATH Movil is named", () => {
    expect(detectInvoicePaymentHint(SUPERMAX_ATH_RECEIPT_OCR, 27.66)).toEqual({ kind: "ath" });
    expect(detectInvoicePaymentHint(SUPERMAX_ATH_RECEIPT_OCR, 30)).toEqual({ kind: "none" });
    expect(detectInvoicePaymentHint("Pagado con ATH Móvil", 5)).toEqual({ kind: "ath" });
  });

  it("does not read ATH when the printed total and the ATH amount differ", () => {
    expect(detectInvoicePaymentHint("Total 27.66\nATH 5.00", 0)).toEqual({ kind: "none" });
  });

  it("finds no payment on a supplier invoice or a phone number", () => {
    expect(detectInvoicePaymentHint("Tel (787)723-1611 Fax (787)721-6988\nTOTAL 26.54", 26.54)).toEqual({
      kind: "none",
    });
  });
});

describe("suggestInvoicePayment", () => {
  it("posts a Costco Ending in 4007 receipt to the VISA x4007 card", () => {
    expect(suggest("Ending in 4007 $4.99")).toEqual({
      payment: { kind: "credit_card", account: "23300 · VISA x4007", checkNumber: "" },
      note: null,
    });
  });

  it("matches the AMEX - 02000 card from 02000 or 2000", () => {
    expect(suggest("AMEX - 02000").payment.account).toBe("23400 · AMEX - 02000");
    expect(suggest("Ending in 2000").payment.account).toBe("23400 · AMEX - 02000");
  });

  it("matches Amex-12007 from 2007 and 12007, and never from 4007", () => {
    expect(suggest("Ending in 2007").payment).toEqual({
      kind: "credit_card",
      account: "23600 · Amex-12007",
      checkNumber: "",
    });
    expect(suggest("AMEX x12007").payment.account).toBe("23600 · Amex-12007");
    expect(suggest("Ending in 4007").payment.account).toBe("23300 · VISA x4007");
  });

  it("sends a debit card that is not a credit card account to the bank as check x1837", () => {
    expect(suggest("DEBIT xxxx1837")).toEqual({
      payment: { kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "x1837" },
      note: "Card x1837 is not a credit card account in QuickBooks. Defaulted to bank.",
    });
  });

  it("treats any CreditCard-type account as a target, so a 1006 receipt posts to 27200 AMEX - 1006", () => {
    expect(suggest("Ending in 1006").payment).toEqual({
      kind: "credit_card",
      account: "27200 · AMEX - 1006",
      checkNumber: "",
    });
  });

  it("books the SuperMax ATH receipt as a bank check numbered ATH", () => {
    expect(
      suggestInvoicePayment({ ocrText: SUPERMAX_ATH_RECEIPT_OCR, total: 27.66, accounts: SEMILLA_ACCOUNTS }),
    ).toEqual({
      payment: { kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "ATH" },
      note: null,
    });
  });

  it("books the SuperMax ATH receipt from its own total when none is passed", () => {
    expect(
      suggestInvoicePayment({ ocrText: SUPERMAX_ATH_RECEIPT_OCR, total: 0, accounts: SEMILLA_ACCOUNTS }),
    ).toEqual({
      payment: { kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "ATH" },
      note: null,
    });
  });

  it("leaves the bank unselected when more than one bank account exists", () => {
    const twoBanks = [...SEMILLA_ACCOUNTS, account("bank-2", "10100", "Oriental - 5555", "Bank")];
    expect(
      suggestInvoicePayment({ ocrText: SUPERMAX_ATH_RECEIPT_OCR, total: 27.66, accounts: twoBanks }).payment,
    ).toEqual({ kind: "check", account: "", checkNumber: "ATH" });
  });

  it("sends the Sam's Club Ending in 8670 receipt to the bank as check x8670", () => {
    expect(
      suggestInvoicePayment({ ocrText: SAMS_CLUB_RECEIPT_OCR, total: 390.13, accounts: SEMILLA_ACCOUNTS }),
    ).toEqual({
      payment: { kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "x8670" },
      note: "Card x8670 is not a credit card account in QuickBooks. Defaulted to bank.",
    });
  });

  it("reads the same Sam's Club payment from pdf.js text that arrives space-joined", async () => {
    const text = await pdfJsText(SAMS_CLUB_RECEIPT_OCR);
    expect(text.split("\n")).toHaveLength(1);
    expect(suggestInvoicePayment({ ocrText: text, total: 390.13, accounts: SEMILLA_ACCOUNTS }).payment).toEqual({
      kind: "check",
      account: "10000 · BPPR - 016374290",
      checkNumber: "x8670",
    });
  });

  it("posts the synthetic Costco PDF text with a masked Visa tender to VISA x4007", async () => {
    const text = await pdfJsText(COSTCO_SYNTHETIC_PDF_TEXT);
    expect(suggestInvoicePayment({ ocrText: text, total: 562.14, accounts: SEMILLA_ACCOUNTS })).toEqual({
      payment: { kind: "credit_card", account: "23300 · VISA x4007", checkNumber: "" },
      note: null,
    });
  });

  it("does not pair a card label with a far-away or money number", () => {
    const farAway = `VISA accepted here ${"word ".repeat(10)}Store 1837 TOTAL 9.99`;
    expect(detectInvoicePaymentHint(farAway, 9.99)).toEqual({ kind: "none" });
    expect(detectInvoicePaymentHint("TOTAL 1234.56 VISA $1234.56", 1234.56)).toEqual({ kind: "none" });
  });

  it("reads a Visa ending in label split from its digits by pdf.js", () => {
    expect(detectInvoicePaymentHint("TOTAL 562.14 Visa ending in Card Holder Copy 4007 APPROVED", 562.14)).toEqual({
      kind: "card",
      digits: "4007",
    });
  });

  it("keeps a supplier invoice with no payment line as a bill", () => {
    expect(suggest("Terms Net 15")).toEqual({
      payment: { kind: "bill", account: "", checkNumber: "" },
      note: null,
    });
  });
});

describe("paymentAccountsForKind", () => {
  it("offers credit card accounts for cards and bank accounts for checks, including Online type names", () => {
    const online = account("qbo-9", "", "Chase Visa", "Credit Card");
    expect(paymentAccountsForKind("credit_card", [...SEMILLA_ACCOUNTS, online]).map((row) => row.list_id)).toEqual([
      "cc-1",
      "cc-2",
      "cc-3",
      "cc-4",
      "cc-5",
      "qbo-9",
    ]);
    expect(paymentAccountsForKind("check", SEMILLA_ACCOUNTS).map((row) => row.list_id)).toEqual(["bank-1"]);
  });
});

describe("parseInvoicePayment", () => {
  it("parses stored columns into a payment", () => {
    expect(parseInvoicePayment({ payment_kind: "bill", payment_account: null, payment_ref: null })).toEqual({
      kind: "bill",
    });
    expect(parseInvoicePayment({})).toEqual({ kind: "bill" });
    expect(
      parseInvoicePayment({ payment_kind: "credit_card", payment_account: " 23300 · VISA x4007 ", payment_ref: null }),
    ).toEqual({ kind: "credit_card", account: "23300 · VISA x4007" });
    expect(
      parseInvoicePayment({ payment_kind: "check", payment_account: "10000 · BPPR - 016374290", payment_ref: "ATH" }),
    ).toEqual({ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "ATH" });
    expect(
      parseInvoicePayment({ payment_kind: "check", payment_account: "10000 · BPPR - 016374290", payment_ref: " " }),
    ).toEqual({ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: null });
  });

  it("rejects a card or check with no account, and unknown kinds", () => {
    expect(parseInvoicePayment({ payment_kind: "credit_card", payment_account: "" })).toEqual({
      error: "Pick the credit card account this receipt was paid with",
    });
    expect(parseInvoicePayment({ payment_kind: "check", payment_account: null, payment_ref: "ATH" })).toEqual({
      error: "Pick the bank account this receipt was paid from",
    });
    expect(parseInvoicePayment({ payment_kind: "cash" })).toEqual({ error: 'Unknown payment type "cash"' });
  });
});

describe("invoice payment columns", () => {
  it("round-trips a check draft and clears account and ref for bills", () => {
    const columns = invoicePaymentColumns({ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "ATH" });
    expect(columns).toEqual({ payment_kind: "check", payment_account: "10000 · BPPR - 016374290", payment_ref: "ATH" });
    expect(draftFromInvoiceColumns(columns)).toEqual({
      kind: "check",
      account: "10000 · BPPR - 016374290",
      checkNumber: "ATH",
    });
    expect(invoicePaymentColumns({ kind: "bill", account: "23300 · VISA x4007", checkNumber: "ATH" })).toEqual({
      payment_kind: "bill",
      payment_account: null,
      payment_ref: null,
    });
  });
});
