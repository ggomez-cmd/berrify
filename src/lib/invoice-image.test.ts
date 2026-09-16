import { describe, expect, it } from "vitest";
import {
  assertInvoiceImage,
  isRasterDataUrl,
  MAX_INVOICE_IMAGE_BYTES,
  toRasterDataUrl,
} from "./invoice-image";

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

describe("isRasterDataUrl / toRasterDataUrl", () => {
  const jpegDataUrl = "data:image/jpeg;base64,/9j/4AAQ";

  it("accepts raster data URLs and rejects svg data URLs", () => {
    expect(isRasterDataUrl(jpegDataUrl)).toBe(true);
    expect(isRasterDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isRasterDataUrl("https://example.supabase.co/storage/v1/object/public/bills/a.jpg")).toBe(
      false,
    );
  });

  it("rewrites octet-stream JPEG data URLs into raster image data URLs", async () => {
    const stored = "data:application/octet-stream;base64,/9j/4AAQ";
    await expect(toRasterDataUrl(stored)).resolves.toBe("data:image/jpeg;base64,/9j/4AAQ");
  });

  it("returns an existing raster data URL unchanged", async () => {
    await expect(toRasterDataUrl(jpegDataUrl)).resolves.toBe(jpegDataUrl);
  });

  it("fetches https and blob storage URLs into a raster data URL", async () => {
    const bytes = Uint8Array.from(atob("/9j/4AAQ"), (c) => c.charCodeAt(0));
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://example.supabase.co/storage/v1/object/public/bills/a.jpg");
      return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
    };
    const result = await toRasterDataUrl(
      "https://example.supabase.co/storage/v1/object/public/bills/a.jpg",
      fetchImpl,
    );
    expect(result.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(isRasterDataUrl(result)).toBe(true);
  });

  it("rejects svg downloads and empty input", async () => {
    await expect(toRasterDataUrl("")).rejects.toThrow(/missing/);
    const fetchImpl: typeof fetch = async () =>
      new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } });
    await expect(toRasterDataUrl("https://cdn.example/bill.svg", fetchImpl)).rejects.toThrow(
      /raster image/,
    );
  });
});
