import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "./invoice-extract";
import {
  reviewedExamplesForVendor,
  skuAliasesFromReview,
  vendorAliasFromReview,
} from "./invoice-review-memory";

describe("vendorAliasFromReview", () => {
  it("upserts a normalized match when a supplier is set", () => {
    expect(
      vendorAliasFromReview({
        supplierId: "sup-1",
        vendorName: "  Ballester Hermanos  ",
        qboVendorName: "Ballester Hermanos Inc",
      }),
    ).toEqual({
      match_text: "ballester hermanos",
      supplier_id: "sup-1",
      qbo_vendor_name: "Ballester Hermanos Inc",
    });
  });

  it("skips when no supplier is selected", () => {
    expect(
      vendorAliasFromReview({
        supplierId: null,
        vendorName: "Ballester",
        qboVendorName: "Ballester",
      }),
    ).toBeNull();
  });
});

describe("skuAliasesFromReview", () => {
  it("keeps SKU codes and expense memos", () => {
    const aliases = skuAliasesFromReview(
      [
        {
          code: "4128",
          description: "Cheddar bag",
          qty_ordered: 1,
          qty_shipped: 1,
          uom: "CS",
          pounds: null,
          unit_price: 10,
          amount: 10,
          category: "food",
        },
      ],
      [{ account: ACCOUNTS.kitchen, amount: 4, memo: "Cups" }],
    );
    expect(aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match_text: "4128",
          account: ACCOUNTS.food,
          category: "food",
        }),
        expect.objectContaining({
          match_text: "cups",
          account: ACCOUNTS.kitchen,
        }),
      ]),
    );
  });
});

describe("reviewedExamplesForVendor", () => {
  it("returns the last reviewed bills for the OCR vendor", () => {
    const examples = reviewedExamplesForVendor(
      [
        {
          status: "reviewed",
          supplier_id: "sup-1",
          vendor_name: "Ballester",
          invoice_number: "A",
          invoice_date: "2026-08-01",
          total: 10,
          invoice_lines: [],
          invoice_expense_lines: [],
        },
        {
          status: "received",
          supplier_id: "sup-1",
          vendor_name: "Ballester",
          invoice_number: "B",
          invoice_date: "2026-08-02",
          total: 11,
        },
        {
          status: "reviewed",
          supplier_id: "sup-2",
          vendor_name: "Other",
          invoice_number: "C",
          invoice_date: "2026-08-03",
          total: 12,
        },
      ],
      "BALLESTER HERMANOS NUM. FACTURA",
      [{ match_text: "ballester", supplier_id: "sup-1" }],
    );
    expect(examples).toHaveLength(1);
    expect(examples[0]?.invoice_number).toBe("A");
  });
});
