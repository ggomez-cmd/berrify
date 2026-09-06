import { describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  addDaysIso,
  classifySku,
  extractInvoiceFromText,
  extractInvoicesFromText,
  rollupExpenses,
  stripPriceSuffix,
  toQuickBooksBillIif,
} from "./invoice-extract";
import {
  BALLESTER_OCR,
  DROUYN_OCR,
  FERNANDEZ_OCR,
  JOSE_SANTIAGO_BACON_OCR,
  JOSE_SANTIAGO_OCR,
  NORTHWESTERN_OCR,
  SANTURCE_OCR,
  SUPERMAX_OCR,
} from "./invoice-fixtures";

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
    expect(classifySku("Ron Tresclavos Cafe").category).toBe("beverage");
    expect(classifySku("West Coast IPA").category).toBe("beverage");
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

  it("does not treat a SKU code as the invoice number", () => {
    const noRef = extractInvoiceFromText("1 1 CS 0118041 MAGNUM WINGS 60.08C 240.32");
    expect(noRef.invoice_number).toBeNull();
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

describe("fuzzy OCR lines", () => {
  it("recovers a messy fries line with a trailing amount", () => {
    const extracted = extractInvoiceFromText(
      "L E a 1%. BAY COATED 8/8 F. FRY 5g. 1c 233.24\nMunicipal Auth T: $11.22\nPR Territory Auth: $21.73\nSubtotal $1,122.64",
    );
    expect(extracted.lines.some((l) => /fry/i.test(l.description) && l.amount === 233.24)).toBe(true);
    expect(extracted.tax).toBeCloseTo(32.95);
  });
});

describe("Ballester Hermanos", () => {
  const extracted = extractInvoiceFromText(BALLESTER_OCR);

  it("does not treat the customer Benmaman as the vendor", () => {
    expect(extracted.qbo_vendor_name).toBe("Ballester Hermanos Inc");
    expect(extracted.invoice_number).toBe("40494738");
    expect(extracted.invoice_date).toBe("2026-08-13");
    expect(extracted.due_date).toBe("2026-09-12");
    expect(extracted.terms).toBe("Net 30");
    expect(extracted.total).toBeCloseTo(757.56);
    expect(extracted.tax).toBeCloseTo(0);
  });

  it("reads weight and case lines as food", () => {
    expect(extracted.lines).toHaveLength(4);
    expect(extracted.lines.find((l) => l.code === "37785")?.amount).toBeCloseTo(166.38);
    expect(extracted.lines.find((l) => l.code === "03194")?.pounds).toBeCloseTo(79.1);
    expect(extracted.expenses[0]?.account).toBe(ACCOUNTS.food);
    expect(extracted.expenses[0]?.amount).toBeCloseTo(757.56);
  });
});

describe("SuperMax receipt", () => {
  const extracted = extractInvoiceFromText(SUPERMAX_OCR);

  it("rolls food plus PR tax", () => {
    expect(extracted.qbo_vendor_name).toBe("SuperMax");
    expect(extracted.invoice_number).toBe("000000058724");
    expect(extracted.invoice_date).toBe("2026-08-14");
    expect(extracted.due_date).toBe("2026-08-14");
    expect(extracted.tax).toBeCloseTo(0.49);
    expect(extracted.total).toBeCloseTo(48.44);
    expect(extracted.terms).toBe("Due on receipt");
    expect(extracted.lines.length).toBeGreaterThanOrEqual(5);
    expect(extracted.expenses.find((e) => e.account === ACCOUNTS.tax)?.amount).toBeCloseTo(0.49);
    expect(extracted.expenses.find((e) => e.account === ACCOUNTS.food)?.amount).toBeCloseTo(47.95);
  });
});

describe("messy Ballester+SuperMax OCR", () => {
  const ocr = `
BALLESTER | HERMANOS
NUM. FACTURA
DANIEL BENMAMAN MEDINA/CAN ENTERPRISE 40494738
10 LB BEEF GROUND 80/20 03194 5.4999 435.04
64 OZ JUICE PINEAPPLE LOTUS 80015 47.34 47.34
57.5 OZ COCONUT CREAM COCO LOPEZ 09850 108.80 108.80
SUBTOTAL 757.56
Municipal Sales Tax 757.56 .000 0.00
SUPERHAX T-SHIRT LDPE BAG 0.10
8/14/2026 6:56:04 PM
BOARS HEAD CANADIAN CHEDDAR 9.39
SubTotal 47.95
Tax Municipal 1% 0.48
Tax Estatal 10.5% 0.01
TOTAL 48.44
Invoice #: 000000058724
`;
  const bills = extractInvoicesFromText(ocr);

  it("splits and keeps Ballester as the vendor", () => {
    expect(bills.map((b) => b.qbo_vendor_name)).toEqual(["Ballester Hermanos Inc", "SuperMax"]);
    expect(bills[0]?.invoice_number).toBe("40494738");
    expect(bills[0]?.total).toBeCloseTo(757.56);
    expect(bills[0]?.lines.some((l) => l.code === "03194" && l.amount === 435.04)).toBe(true);
    expect(bills[1]?.invoice_number).toBe("000000058724");
    expect(bills[1]?.total).toBeCloseTo(48.44);
    expect(bills[1]?.tax).toBeCloseTo(0.49);
    expect(bills[1]?.invoice_date).toBe("2026-08-14");
  });
});

describe("extractInvoicesFromText", () => {
  it("splits a Ballester + SuperMax photo into two bills", () => {
    const bills = extractInvoicesFromText(`${BALLESTER_OCR}\n${SUPERMAX_OCR}`);
    expect(bills).toHaveLength(2);
    expect(bills[0]?.qbo_vendor_name).toBe("Ballester Hermanos Inc");
    expect(bills[0]?.total).toBeCloseTo(757.56);
    expect(bills[1]?.qbo_vendor_name).toBe("SuperMax");
    expect(bills[1]?.total).toBeCloseTo(48.44);
    expect(bills[0]?.invoice_date).toBe("2026-08-13");
    expect(bills[1]?.invoice_date).toBe("2026-08-14");
  });
});

describe("Jose Santiago bacon", () => {
  const extracted = extractInvoiceFromText(JOSE_SANTIAGO_BACON_OCR);

  it("keeps the $243.49 bacon bill and skips the $0 layout", () => {
    expect(extracted.qbo_vendor_name).toBe("Jose Santiago Inc");
    expect(extracted.invoice_number).toBe("6517569");
    expect(extracted.invoice_date).toBe("2023-08-14");
    expect(extracted.total).toBeCloseTo(243.49);
    expect(extracted.tax).toBeCloseTo(2.41);
    expect(extracted.lines).toHaveLength(1);
    expect(extracted.lines[0]?.amount).toBeCloseTo(241.08);
  });
});

describe("Drouyn & Co", () => {
  const extracted = extractInvoiceFromText(DROUYN_OCR);

  it("skips the back-ordered potato and bills produce only", () => {
    expect(extracted.qbo_vendor_name).toBe("Drouyn & Co");
    expect(extracted.invoice_number).toBe("01014389");
    expect(extracted.invoice_date).toBe("2026-08-09");
    expect(extracted.due_date).toBe("2026-08-16");
    expect(extracted.terms).toBe("Net 7");
    expect(extracted.total).toBeCloseTo(61.5);
    expect(extracted.tax).toBeCloseTo(0);
    expect(extracted.lines).toHaveLength(5);
    expect(extracted.lines.some((l) => /creamer/i.test(l.description))).toBe(false);
  });
});

describe("Santurce Brewing", () => {
  const extracted = extractInvoiceFromText(SANTURCE_OCR);

  it("rolls beer plus PR tax", () => {
    expect(extracted.qbo_vendor_name).toBe("Santurce Brewing Inc");
    expect(extracted.invoice_number).toBe("E-13563");
    expect(extracted.invoice_date).toBe("2026-08-04");
    expect(extracted.due_date).toBe("2026-08-19");
    expect(extracted.terms).toBe("Net 15");
    expect(extracted.tax).toBeCloseTo(8.05);
    expect(extracted.total).toBeCloseTo(78.05);
    expect(extracted.expenses.find((e) => e.account === ACCOUNTS.beverage)?.amount).toBeCloseTo(70);
    expect(extracted.expenses.find((e) => e.account === ACCOUNTS.tax)?.amount).toBeCloseTo(8.05);
  });
});

describe("B. Fernandez rum", () => {
  const extracted = extractInvoiceFromText(FERNANDEZ_OCR);

  it("links the fernandez alias when the letterhead has an accent", () => {
    const withAlias = extractInvoiceFromText(FERNANDEZ_OCR, [
      { match_text: "fernandez", supplier_id: "sup-f", qbo_vendor_name: "B. Fernandez & Hnos Inc" },
    ]);
    expect(withAlias.supplier_id).toBe("sup-f");
    expect(withAlias.qbo_vendor_name).toBe("B. Fernandez & Hnos Inc");
  });

  it("does not treat Kane / CAN ENTERPRISE as the vendor", () => {
    expect(extracted.qbo_vendor_name).toBe("B. Fernandez & Hnos Inc");
    expect(extracted.invoice_number).toBe("4275290");
    expect(extracted.invoice_date).toBe("2026-08-17");
    expect(extracted.due_date).toBe("2026-09-16");
    expect(extracted.terms).toBe("Net 30");
    expect(extracted.lines).toHaveLength(8);
    expect(extracted.tax).toBeCloseTo(18.86);
    expect(extracted.total).toBeCloseTo(182.86);
    expect(extracted.expenses.find((e) => e.account === ACCOUNTS.beverage)?.amount).toBeCloseTo(164);
  });
});

describe("Northwestern Selecta", () => {
  const extracted = extractInvoiceFromText(NORTHWESTERN_OCR);

  it("reads weight lines and ignores the conduce number", () => {
    expect(extracted.qbo_vendor_name).toBe("Northwestern Selecta");
    expect(extracted.invoice_number).toBe("4128806");
    expect(extracted.invoice_date).toBe("2026-08-12");
    expect(extracted.due_date).toBe("2026-08-19");
    expect(extracted.terms).toBe("Net 7");
    expect(extracted.total).toBeCloseTo(446.27);
    expect(extracted.lines).toHaveLength(3);
    expect(extracted.lines.find((l) => l.code === "148590")?.pounds).toBeCloseTo(10);
    expect(extracted.expenses[0]?.account).toBe(ACCOUNTS.food);
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
