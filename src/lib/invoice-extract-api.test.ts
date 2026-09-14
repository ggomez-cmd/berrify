import { describe, expect, it, vi } from "vitest";
import { extractEngineNote, extractInvoicesAfterOcr } from "./invoice-extract-api";
import { DEFAULT_ACCOUNT_RULES } from "./invoice-extract";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "user-token" } } }),
    },
  },
}));

const RULES_OCR = `
BALLESTER HERMANOS
NUM. FACTURA 12345
Fecha 8/13/26
SUBTOTAL $757.56
TOTAL $757.56
`.trim();

describe("extractInvoicesAfterOcr", () => {
  it("uses Gemini invoices when /api/invoice-extract succeeds", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("/api/invoice-extract");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-token");
      const body = JSON.parse(String(init?.body ?? "{}")) as { ocr_text?: string; image?: string };
      expect(body.ocr_text).toContain("BALLESTER HERMANOS");
      expect(body.image).toBeUndefined();
      return Response.json({
        engine: "gemini",
        invoices: [
          {
            vendor_name: "Gemini Vendor",
            qbo_vendor_name: "Gemini Vendor",
            supplier_id: null,
            invoice_number: "G-1",
            invoice_date: "2026-08-13",
            due_date: null,
            terms: "Net 15",
            subtotal: 12,
            tax: 0,
            total: 12,
            lines: [],
            expenses: [],
          },
        ],
      });
    };
    const result = await extractInvoicesAfterOcr({
      ocrText: `${RULES_OCR}\n${RULES_OCR}\n${RULES_OCR}`,
      image: "data:image/jpeg;base64,abc",
      confidence: 90,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      fetchImpl,
    });
    expect(result.engine).toBe("gemini");
    expect(result.invoices[0]?.vendor_name).toBe("Gemini Vendor");
    expect(result.invoices[0]?.total).toBe(12);
  });

  it("falls back to rules when extract returns 503", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: "Gemini extract is not configured" }, { status: 503 });
    const result = await extractInvoicesAfterOcr({
      ocrText: RULES_OCR,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      fetchImpl,
    });
    expect(result.engine).toBe("rules");
    expect(result.invoices.length).toBeGreaterThan(0);
    expect(result.invoices[0]?.total).toBeGreaterThan(0);
  });

  it("sends the photo only when OCR text is thin", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { image?: string };
      expect(body.image).toBe("data:image/jpeg;base64,abc");
      return Response.json({ error: "Gemini extract is not configured" }, { status: 503 });
    };
    const result = await extractInvoicesAfterOcr({
      ocrText: "hi",
      image: "data:image/jpeg;base64,abc",
      confidence: 10,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      fetchImpl,
    });
    expect(result.engine).toBe("rules");
  });
});

describe("extractEngineNote", () => {
  it("names Gemini vs rules", () => {
    expect(extractEngineNote("gemini")).toBe("Gemini extract");
    expect(extractEngineNote("rules")).toBe("Rules extract");
  });
});
