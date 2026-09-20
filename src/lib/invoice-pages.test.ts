import { describe, expect, it } from "vitest";
import { extractInvoicesFromText } from "./invoice-extract";
import { VISION_BALLESTER_SUPERMAX_OCR } from "./invoice-fixtures";
import {
  invoicesToPersistFromPhoto,
  isPageAttachCaption,
  shouldAttachInvoicePage,
} from "./invoice-pages";

describe("one photo one invoice", () => {
  it("does not persist a second invoice from a two-vendor fixture photo", () => {
    const extracted = extractInvoicesFromText(VISION_BALLESTER_SUPERMAX_OCR);
    expect(extracted.length).toBeGreaterThan(1);
    expect(invoicesToPersistFromPhoto(extracted)).toHaveLength(1);
    expect(invoicesToPersistFromPhoto(extracted)[0]?.qbo_vendor_name).toBe("Ballester Hermanos Inc");
  });
});

describe("invoice page attach", () => {
  it("attaches album and page-2 captions", () => {
    expect(isPageAttachCaption("page 2 Semilla")).toBe(true);
    expect(isPageAttachCaption("p. 2")).toBe(true);
    expect(
      shouldAttachInvoicePage({
        sameMediaGroup: true,
        pageCaption: false,
        sameInvoiceNumber: false,
        withinWindow: true,
      }),
    ).toBe(true);
    expect(
      shouldAttachInvoicePage({
        sameMediaGroup: false,
        pageCaption: true,
        sameInvoiceNumber: false,
        withinWindow: true,
      }),
    ).toBe(true);
  });

  it("does not attach a different vendor FullName", () => {
    expect(
      shouldAttachInvoicePage({
        sameMediaGroup: true,
        pageCaption: true,
        sameInvoiceNumber: true,
        withinWindow: true,
        incomingVendorFullName: "SuperMax",
        existingVendorFullName: "Ballester Hermanos Inc",
      }),
    ).toBe(false);
  });
});
