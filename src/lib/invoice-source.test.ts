import { describe, expect, it } from "vitest";
import { invoiceSourceLabel } from "./invoice-source";

describe("invoiceSourceLabel", () => {
  it("labels each invoice source", () => {
    expect(invoiceSourceLabel("upload")).toBe("Upload");
    expect(invoiceSourceLabel("whatsapp")).toBe("WhatsApp");
    expect(invoiceSourceLabel("camera")).toBe("Camera");
    expect(invoiceSourceLabel("telegram")).toBe("Telegram");
  });
});
