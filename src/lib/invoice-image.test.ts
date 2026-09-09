import { describe, expect, it } from "vitest";
import { assertInvoiceImage, MAX_INVOICE_IMAGE_BYTES } from "./invoice-image";

function file(name: string, type: string, size = 16): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

describe("assertInvoiceImage", () => {
  it("accepts jpeg photos", () => {
    expect(() => assertInvoiceImage(file("bill.jpg", "image/jpeg"))).not.toThrow();
  });

  it("rejects svg and non-images", () => {
    expect(() => assertInvoiceImage(file("bill.svg", "image/svg+xml"))).toThrow(/raster image/);
    expect(() => assertInvoiceImage(file("bill.pdf", "application/pdf"))).toThrow(/raster image/);
  });

  it("rejects oversized files", () => {
    expect(() =>
      assertInvoiceImage(file("huge.jpg", "image/jpeg", MAX_INVOICE_IMAGE_BYTES + 1)),
    ).toThrow(/8 MB/);
  });
});
