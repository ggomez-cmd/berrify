import type { ExtractedInvoice, ExtractedSku, ExpenseLine, InvoiceCategory } from "../src/lib/invoice-extract";
import { isThinOcrText } from "../src/lib/ocr-thin";
import { parseImageDataUrl, requireSession, type OcrPostEnv } from "./ocr-post";

export const GEMINI_FLASH_MODEL = "gemini-2.5-flash";

export type InvoiceExtractEnv = OcrPostEnv & {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

const CATEGORIES: readonly InvoiceCategory[] = [
  "food",
  "kitchen",
  "cleaning",
  "tax",
  "beverage",
  "other",
];

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export { isThinOcrText };

function asFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asCategory(value: unknown): InvoiceCategory {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) {
    return value as InvoiceCategory;
  }
  return "food";
}

function parseSku(value: unknown): ExtractedSku | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const description = asNullableString(row.description);
  if (!description) return null;
  return {
    code: asNullableString(row.code),
    description,
    qty_ordered: asFiniteNumber(row.qty_ordered),
    qty_shipped: asFiniteNumber(row.qty_shipped),
    uom: asNullableString(row.uom),
    pounds: row.pounds == null ? null : asFiniteNumber(row.pounds),
    unit_price: asFiniteNumber(row.unit_price),
    amount: asFiniteNumber(row.amount),
    category: asCategory(row.category),
  };
}

function parseExpense(value: unknown): ExpenseLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const account = asNullableString(row.account);
  if (!account) return null;
  return {
    account,
    amount: asFiniteNumber(row.amount),
    memo: asNullableString(row.memo) ?? "",
  };
}

export function parseExtractedInvoices(payload: unknown): ExtractedInvoice[] | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { invoices?: unknown };
  if (!Array.isArray(root.invoices)) return null;
  const invoices: ExtractedInvoice[] = [];
  for (const item of root.invoices) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const lines = Array.isArray(row.lines)
      ? row.lines.map(parseSku).filter((line): line is ExtractedSku => line !== null)
      : [];
    const expenses = Array.isArray(row.expenses)
      ? row.expenses.map(parseExpense).filter((line): line is ExpenseLine => line !== null)
      : [];
    invoices.push({
      vendor_name: asNullableString(row.vendor_name),
      qbo_vendor_name: asNullableString(row.qbo_vendor_name) ?? "",
      supplier_id: asNullableString(row.supplier_id),
      invoice_number: asNullableString(row.invoice_number),
      invoice_date: asNullableString(row.invoice_date),
      due_date: asNullableString(row.due_date),
      terms: asNullableString(row.terms) ?? "",
      subtotal: asFiniteNumber(row.subtotal),
      tax: asFiniteNumber(row.tax),
      total: asFiniteNumber(row.total),
      lines,
      expenses,
    });
  }
  return invoices;
}

function extractGeminiJsonText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!first || typeof first !== "object") return null;
  const parts = (first as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  const chunks: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      chunks.push((part as { text: string }).text);
    }
  }
  const text = chunks.join("").trim();
  return text || null;
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    invoices: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          vendor_name: { type: "STRING", nullable: true },
          qbo_vendor_name: { type: "STRING" },
          supplier_id: { type: "STRING", nullable: true },
          invoice_number: { type: "STRING", nullable: true },
          invoice_date: { type: "STRING", nullable: true },
          due_date: { type: "STRING", nullable: true },
          terms: { type: "STRING" },
          subtotal: { type: "NUMBER" },
          tax: { type: "NUMBER" },
          total: { type: "NUMBER" },
          lines: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                code: { type: "STRING", nullable: true },
                description: { type: "STRING" },
                qty_ordered: { type: "NUMBER" },
                qty_shipped: { type: "NUMBER" },
                uom: { type: "STRING", nullable: true },
                pounds: { type: "NUMBER", nullable: true },
                unit_price: { type: "NUMBER" },
                amount: { type: "NUMBER" },
                category: { type: "STRING" },
              },
              required: ["description", "qty_ordered", "qty_shipped", "unit_price", "amount", "category"],
            },
          },
          expenses: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                account: { type: "STRING" },
                amount: { type: "NUMBER" },
                memo: { type: "STRING" },
              },
              required: ["account", "amount", "memo"],
            },
          },
        },
        required: [
          "qbo_vendor_name",
          "terms",
          "subtotal",
          "tax",
          "total",
          "lines",
          "expenses",
        ],
      },
    },
  },
  required: ["invoices"],
} as const;

function buildPrompt(body: {
  ocr_text: string;
  restaurants?: unknown;
  vendor_aliases?: unknown;
  account_rules?: unknown;
  sku_aliases?: unknown;
  examples?: unknown;
}): string {
  return [
    "Extract one or more supplier invoices from Puerto Rico restaurant OCR text.",
    "Return JSON only matching the schema. Split stacked receipts into separate invoices.",
    "Use vendor_aliases to set supplier_id and qbo_vendor_name when the print name matches.",
    "Use account_rules and sku_aliases for expense accounts and SKU categories.",
    "Prefer reviewed examples for the same vendor when they contradict generic guesses.",
    "Dates must be YYYY-MM-DD or null. Money is USD numbers, not strings.",
    "Do not invent invoice numbers that are customer, order, or sticker ids when a factura number is present.",
    "",
    `OCR text:\n${body.ocr_text}`,
    "",
    `Restaurants: ${JSON.stringify(body.restaurants ?? [])}`,
    `Vendor aliases: ${JSON.stringify(body.vendor_aliases ?? [])}`,
    `Account rules: ${JSON.stringify(body.account_rules ?? [])}`,
    `SKU aliases: ${JSON.stringify(body.sku_aliases ?? [])}`,
    `Reviewed examples: ${JSON.stringify(body.examples ?? [])}`,
  ].join("\n");
}

export async function handleInvoiceExtractPost(
  request: Request,
  env: InvoiceExtractEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const denied = await requireSession(request, env, fetchImpl);
  if (denied) return denied;

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return json({ error: "Gemini extract is not configured" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid JSON" }, 400);
  }

  const row = body as {
    ocr_text?: unknown;
    image?: unknown;
    confidence?: unknown;
    restaurants?: unknown;
    vendor_aliases?: unknown;
    account_rules?: unknown;
    sku_aliases?: unknown;
    examples?: unknown;
  };

  if (typeof row.ocr_text !== "string") {
    return json({ error: "ocr_text is required" }, 400);
  }

  const confidence = typeof row.confidence === "number" ? row.confidence : undefined;
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: buildPrompt({ ...row, ocr_text: row.ocr_text }) },
  ];

  if (row.image !== undefined && isThinOcrText(row.ocr_text, confidence)) {
    const parsed = parseImageDataUrl(row.image);
    if (!parsed.ok) {
      return json({ error: parsed.error }, parsed.status);
    }
    parts.push({
      inline_data: {
        mime_type: parsed.mime,
        data: parsed.content,
      },
    });
  }

  const model = env.GEMINI_MODEL?.trim() || GEMINI_FLASH_MODEL;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let geminiResponse: Response;
  try {
    geminiResponse = await fetchImpl(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You extract invoice fields for Berrify Review. Never call tools. Never use Google Search. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    return json({ error: "Gemini request failed" }, 502);
  }

  let payload: unknown;
  try {
    payload = await geminiResponse.json();
  } catch {
    return json({ error: "Gemini returned invalid JSON" }, 502);
  }

  if (!geminiResponse.ok) {
    const message =
      payload && typeof payload === "object"
        ? (payload as { error?: { message?: string } }).error?.message
        : undefined;
    return json(
      { error: message?.trim() || "Gemini extract failed" },
      geminiResponse.status >= 400 && geminiResponse.status <= 599 ? geminiResponse.status : 502,
    );
  }

  const text = extractGeminiJsonText(payload);
  if (!text) {
    return json({ error: "Gemini returned no invoices" }, 502);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFence(text));
  } catch {
    return json({ error: "Gemini returned invalid invoice JSON" }, 502);
  }

  const invoices = parseExtractedInvoices(parsedJson);
  if (!invoices || invoices.length === 0) {
    return json({ error: "Gemini returned no invoices" }, 502);
  }

  return json({ invoices, engine: "gemini" }, 200);
}
