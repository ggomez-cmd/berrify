import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "./invoice-extract";
import {
  EXTRACT_EXAMPLE_LIMIT,
  extractExampleUpsert,
  ocrSnippetFromText,
  OCR_SNIPPET_MAX,
  pickClosestExamples,
  skuAliasesFromReview,
  vendorAliasFromReview,
  type ExtractExampleCandidate,
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

describe("extractExampleUpsert", () => {
  it("builds a row with a 4–6k OCR snippet and corrected JSON", () => {
    const row = extractExampleUpsert({
      orgId: "org-1",
      invoiceId: "inv-1",
      supplierId: "sup-1",
      restaurantId: "rest-1",
      ocrText: `  ${"x".repeat(6000)}`,
      qboVendorName: "Jose Santiago",
      vendorName: "JOSE SANTIAGO",
      invoiceNumber: "1080",
      invoiceDate: "2026-08-01",
      total: 44,
      lines: [{ code: "1", description: "Chicken", amount: 40, category: "food" }],
      expenses: [{ account: ACCOUNTS.food, amount: 40, memo: "Chicken" }],
    });
    expect(row).toMatchObject({
      org_id: "org-1",
      invoice_id: "inv-1",
      supplier_id: "sup-1",
      restaurant_id: "rest-1",
    });
    expect(row?.ocr_snippet).toHaveLength(OCR_SNIPPET_MAX);
    expect(row?.corrected).toEqual({
      vendor_name: "JOSE SANTIAGO",
      invoice_number: "1080",
      invoice_date: "2026-08-01",
      total: 44,
      qbo_vendor_name: "Jose Santiago",
      supplier_id: "sup-1",
      lines: [{ code: "1", description: "Chicken", amount: 40, category: "food" }],
      expenses: [{ account: ACCOUNTS.food, amount: 40, memo: "Chicken" }],
    });
  });

  it("skips when OCR text is empty", () => {
    expect(
      extractExampleUpsert({
        orgId: "org-1",
        invoiceId: "inv-1",
        supplierId: null,
        restaurantId: null,
        ocrText: "   ",
        qboVendorName: "",
        vendorName: null,
        invoiceNumber: null,
        invoiceDate: null,
        total: 0,
        lines: [],
        expenses: [],
      }),
    ).toBeNull();
  });
});

function candidate(partial: Partial<ExtractExampleCandidate> & { invoice_id: string }): ExtractExampleCandidate {
  return {
    supplier_id: partial.supplier_id ?? null,
    restaurant_id: partial.restaurant_id ?? null,
    ocr_snippet: partial.ocr_snippet ?? "generic invoice factura total",
    corrected: partial.corrected ?? {
      vendor_name: "Other",
      invoice_number: partial.invoice_id,
      invoice_date: "2026-08-01",
      total: 1,
      lines: [],
      expenses: [],
    },
    invoice_id: partial.invoice_id,
  };
}

describe("pickClosestExamples", () => {
  it("prefers the same supplier when an alias hits", () => {
    const examples = pickClosestExamples(
      "BALLESTER HERMANOS NUM. FACTURA",
      [
        candidate({
          invoice_id: "a",
          supplier_id: "sup-1",
          ocr_snippet: "ballester hermanos factura 111",
          corrected: {
            vendor_name: "Ballester",
            invoice_number: "A",
            invoice_date: "2026-08-01",
            total: 10,
            lines: [],
            expenses: [],
          },
        }),
        candidate({
          invoice_id: "c",
          supplier_id: "sup-2",
          ocr_snippet: "other vendor factura",
          corrected: {
            vendor_name: "Other",
            invoice_number: "C",
            invoice_date: "2026-08-03",
            total: 12,
            lines: [],
            expenses: [],
          },
        }),
      ],
      EXTRACT_EXAMPLE_LIMIT,
      { aliases: [{ match_text: "ballester", supplier_id: "sup-1" }] },
    );
    expect(examples).toHaveLength(1);
    expect(examples[0]?.invoice_number).toBe("A");
    expect(examples[0]?.ocr_snippet).toContain("ballester");
  });

  it("matches letterhead without a vendor alias", () => {
    const examples = pickClosestExamples(
      "JOSE SANTIAGO INC CARNES factura 99",
      [
        candidate({
          invoice_id: "s1",
          supplier_id: "sup-santiago",
          ocr_snippet: "jose santiago carnes drouyn 88",
          corrected: {
            vendor_name: "Jose Santiago",
            qbo_vendor_name: "Jose Santiago Inc",
            invoice_number: "S1",
            invoice_date: "2026-08-01",
            total: 20,
            lines: [],
            expenses: [],
            supplier_id: "sup-santiago",
          },
        }),
        candidate({
          invoice_id: "b1",
          supplier_id: "sup-ballester",
          ocr_snippet: "ballester hermanos",
          corrected: {
            vendor_name: "Ballester",
            invoice_number: "B1",
            invoice_date: "2026-08-01",
            total: 9,
            lines: [],
            expenses: [],
          },
        }),
      ],
    );
    expect(examples.map((row) => row.invoice_number)).toEqual(["S1"]);
  });

  it("falls back to the camera restaurant when no supplier hits", () => {
    const examples = pickClosestExamples(
      "messy ocr with no vendor words factura total",
      [
        candidate({
          invoice_id: "k1",
          restaurant_id: "kane",
          ocr_snippet: "kane rum bar produce",
          corrected: {
            vendor_name: "Local Farm",
            invoice_number: "K1",
            invoice_date: "2026-08-01",
            total: 8,
            lines: [],
            expenses: [],
          },
        }),
        candidate({
          invoice_id: "s1",
          restaurant_id: "semilla",
          ocr_snippet: "semilla kitchen produce",
          corrected: {
            vendor_name: "Local Farm",
            invoice_number: "S1",
            invoice_date: "2026-08-01",
            total: 7,
            lines: [],
            expenses: [],
          },
        }),
      ],
      12,
      { restaurantId: "kane" },
    );
    expect(examples.map((row) => row.invoice_number)).toEqual(["K1"]);
  });

  it("ranks token overlap when alias and restaurant are missing", () => {
    const examples = pickClosestExamples("santiago drouyn carnes 4128 factura", [
      candidate({
        invoice_id: "far",
        ocr_snippet: "ballester hermanos cheddar",
        corrected: {
          vendor_name: "Ballester",
          invoice_number: "FAR",
          invoice_date: "2026-08-01",
          total: 1,
          lines: [],
          expenses: [],
        },
      }),
      candidate({
        invoice_id: "near",
        ocr_snippet: "jose santiago drouyn carnes 4128",
        corrected: {
          vendor_name: "Jose Santiago",
          invoice_number: "NEAR",
          invoice_date: "2026-08-01",
          total: 2,
          lines: [],
          expenses: [],
        },
      }),
    ]);
    expect(examples[0]?.invoice_number).toBe("NEAR");
    expect(examples).toHaveLength(1);
  });

  it("caps at 12 and skips the invoice being reviewed", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      candidate({
        invoice_id: `inv-${index}`,
        supplier_id: "sup-1",
        ocr_snippet: `ballester hermanos factura ${index}`,
        corrected: {
          vendor_name: "Ballester",
          invoice_number: `N${index}`,
          invoice_date: "2026-08-01",
          total: index,
          lines: [],
          expenses: [],
        },
      }),
    );
    const examples = pickClosestExamples(
      "ballester hermanos",
      many,
      EXTRACT_EXAMPLE_LIMIT,
      { aliases: [{ match_text: "ballester", supplier_id: "sup-1" }], excludeInvoiceId: "inv-0" },
    );
    expect(examples).toHaveLength(12);
    expect(examples.some((row) => row.invoice_number === "N0")).toBe(false);
  });
});

describe("ocrSnippetFromText", () => {
  it("keeps the leading OCR characters", () => {
    expect(ocrSnippetFromText("  abc")).toBe("abc");
  });
});
