import { describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  addDaysIso,
  classifySku,
  extractInvoiceFromText,
  rollupExpenses,
  stripPriceSuffix,
  toQuickBooksBillIif,
} from "./invoice-extract";
import { JOSE_SANTIAGO_OCR } from "./invoice-fixtures";

describe("stripPriceSuffix", () => {
  it("drops C / C# / B$ suffixes", () => {
    expect(stripPriceSuffix("60.08C")).toBe(60.08);
    expect(stripPriceSuffix("16.18C#")).toBe(16.18);
    expect(stripPriceSuffix("55.87B$")).toBe(55.87);
  });
});

describe("classifySku", () => {
  it("maps kitchen, cleaning, and food keywords", () => {
    expect(classifySku("PLA CLEAR CUPS 12-14 OZ").category).toBe("kitchen");
    expect(classifySku("BEVERAGE NAPKIN 1PLY").category).toBe("kitchen");
    expect(classifySku("MEDIUM 1 COMP. CONT. 8X8").category).toBe("kitchen");
    expect(classifySku("FABULOSO LAVANDA").category).toBe("cleaning");
    expect(classifySku("MAGNUM FULLY CKD CKN WINGS").category).toBe("food");
  });
});

describe("extractInvoiceFromText", () => {
  const extracted = extractInvoiceFromText(JOSE_SANTIAGO_OCR);

  it("reads vendor, ref, dates, and Net 15 due date", () => {
    expect(extracted.qbo_vendor_name).toBe("Jose Santiago Inc");
    expect(extracted.invoice_number).toBe("6512495");
    expect(extracted.invoice_date).toBe("2026-08-12");
    expect(extracted.due_date).toBe("2026-08-27");
    expect(extracted.terms).toBe("Net 15");
    expect(extracted.vendor_name).toBe("CAN ENTERPRISE LLC");
  });

  it("keeps the letterhead print name when aliases match", () => {
    const withAlias = extractInvoiceFromText(JOSE_SANTIAGO_OCR, [
      { match_text: "can enterprise", supplier_id: "sup-1", qbo_vendor_name: "Jose Santiago Inc" },
    ]);
    expect(withAlias.supplier_id).toBe("sup-1");
    expect(withAlias.vendor_name).toBe("CAN ENTERPRISE LLC");
  });

  it("skips zero-shipped saran wrap and comment blocks", () => {
    expect(extracted.lines.some((l) => /saran/i.test(l.description))).toBe(false);
    expect(extracted.lines.some((l) => /martes/i.test(l.description))).toBe(false);
  });

  it("rolls expenses to the QuickBooks Bill split", () => {
    const byAccount = Object.fromEntries(extracted.expenses.map((e) => [e.account, e]));
    expect(byAccount[ACCOUNTS.tax]?.amount).toBeCloseTo(32.95);
    expect(byAccount[ACCOUNTS.tax]?.memo).toBe("Tax");
    expect(byAccount[ACCOUNTS.kitchen]?.amount).toBeCloseTo(176.55);
    expect(byAccount[ACCOUNTS.kitchen]?.memo).toBe("Cups/ napkins /containers");
    expect(byAccount[ACCOUNTS.cleaning]?.amount).toBeCloseTo(30.34);
    expect(byAccount[ACCOUNTS.cleaning]?.memo).toBe("Fabuloso");
    expect(byAccount[ACCOUNTS.food]?.amount).toBeCloseTo(915.75);
    expect(extracted.total).toBeCloseTo(1155.59);
  });
});

describe("addDaysIso", () => {
  it("adds Net 15", () => {
    expect(addDaysIso("2026-08-12", 15)).toBe("2026-08-27");
  });
});

describe("rollupExpenses", () => {
  it("omits empty categories", () => {
    const expenses = rollupExpenses(
      [{ code: "1", description: "OIL", qty_ordered: 1, qty_shipped: 1, uom: "CS", pounds: null, unit_price: 10, amount: 10, category: "food" }],
      0,
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.account).toBe(ACCOUNTS.food);
  });
});

describe("toQuickBooksBillIif", () => {
  it("emits a Desktop BILL with A/P credit and expense debits", () => {
    const extracted = extractInvoiceFromText(JOSE_SANTIAGO_OCR);
    const iif = toQuickBooksBillIif({
      vendor: extracted.qbo_vendor_name,
      invoiceNumber: extracted.invoice_number ?? "",
      invoiceDate: extracted.invoice_date ?? "",
      dueDate: extracted.due_date ?? "",
      terms: extracted.terms,
      apAccount: ACCOUNTS.ap,
      expenses: extracted.expenses,
      total: extracted.total,
    });
    expect(iif).toContain("TRNSTYPE");
    expect(iif).toContain("BILL");
    expect(iif).toContain("Jose Santiago Inc");
    expect(iif).toContain("6512495");
    expect(iif).toContain("20000 · Accounts payable");
    expect(iif).toContain("-1155.59");
    expect(iif).toContain("60025 · Sales tax expense");
    expect(iif).toContain("50000 · Food Purchases");
    expect(iif).toContain("ENDTRNS");
  });
});
