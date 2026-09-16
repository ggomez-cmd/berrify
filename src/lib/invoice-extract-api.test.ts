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
    expect(result.error).toBe("Gemini extract is not configured");
    expect(result.invoices.length).toBeGreaterThan(0);
    expect(result.invoices[0]?.total).toBeGreaterThan(0);
  });

  it("forwards reviewed examples including ocr_snippet", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        examples?: Array<{ invoice_number?: string; ocr_snippet?: string }>;
      };
      expect(body.examples).toEqual([
        expect.objectContaining({ invoice_number: "S1", ocr_snippet: "jose santiago factura" }),
      ]);
      return Response.json({ error: "Gemini extract is not configured" }, { status: 503 });
    };
    await extractInvoicesAfterOcr({
      ocrText: RULES_OCR,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      examples: [
        {
          vendor_name: "Jose Santiago",
          invoice_number: "S1",
          invoice_date: "2026-08-01",
          total: 20,
          lines: [],
          expenses: [],
          ocr_snippet: "jose santiago factura",
          qbo_vendor_name: "Jose Santiago",
          supplier_id: "sup-santiago",
        },
      ],
      fetchImpl,
    });
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

  it("converts a storage URL to a raster data URL when OCR text is thin", async () => {
    const bytes = Uint8Array.from(atob("/9j/4AAQ"), (c) => c.charCodeAt(0));
    let extractImage: string | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://example.supabase.co/storage/v1/object/public/bills/a.jpg") {
        return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
      }
      expect(url).toBe("/api/invoice-extract");
      const body = JSON.parse(String(init?.body ?? "{}")) as { image?: string };
      extractImage = body.image;
      return Response.json({ error: "Gemini extract is not configured" }, { status: 503 });
    };
    const result = await extractInvoicesAfterOcr({
      ocrText: "hi",
      image: "https://example.supabase.co/storage/v1/object/public/bills/a.jpg",
      confidence: 10,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      fetchImpl,
    });
    expect(extractImage?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(result.engine).toBe("rules");
  });

  it("sends the photo when rules extract has no amounts", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { image?: string };
      expect(body.image).toBe("data:image/jpeg;base64,abc");
      return Response.json({ error: "Gemini extract is not configured" }, { status: 503 });
    };
    const result = await extractInvoicesAfterOcr({
      ocrText: `${"NORTHWESTERN SELECTA ".repeat(8)}FACTURA NUMERO 4128806\n148590 BOBBY VEAL SCALLOPINI 6OZ (C) 1`,
      image: "data:image/jpeg;base64,abc",
      confidence: 90,
      vendorAliases: [],
      accountRules: DEFAULT_ACCOUNT_RULES,
      fetchImpl,
    });
    expect(result.engine).toBe("rules");
    expect(result.error).toBe("Gemini extract is not configured");
  });

  it("retries once with the photo when Gemini invoices have no amounts", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { image?: string };
      if (calls === 1) {
        expect(body.image).toBeUndefined();
        return Response.json({
          engine: "gemini",
          invoices: [
            {
              vendor_name: "Empty",
              qbo_vendor_name: "Empty",
              supplier_id: null,
              invoice_number: null,
              invoice_date: null,
              due_date: null,
              terms: "Net 15",
              subtotal: 0,
              tax: 0,
              total: 0,
              lines: [],
              expenses: [],
            },
          ],
        });
      }
      expect(body.image).toBe("data:image/jpeg;base64,abc");
      return Response.json({
        engine: "gemini",
        invoices: [
          {
            vendor_name: "Northwestern Selecta",
            qbo_vendor_name: "Northwestern Selecta",
            supplier_id: null,
            invoice_number: "4128806",
            invoice_date: "2026-08-12",
            due_date: null,
            terms: "Net 7",
            subtotal: 446.27,
            tax: 0,
            total: 446.27,
            lines: [{ description: "VEAL", amount: 114.9, category: "food" }],
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
    expect(calls).toBe(2);
    expect(result.engine).toBe("gemini");
    expect(result.invoices[0]?.total).toBe(446.27);
  });
});

describe("extractEngineNote", () => {
  it("names Gemini vs rules", () => {
    expect(extractEngineNote("gemini")).toBe("Gemini extract");
    expect(extractEngineNote("rules")).toBe("Rules extract");
  });

  it("surfaces Gemini fallback errors on rules extract", () => {
    expect(extractEngineNote("rules", "Gemini extract is not configured")).toBe(
      "Rules extract · Gemini extract is not configured",
    );
  });
});
