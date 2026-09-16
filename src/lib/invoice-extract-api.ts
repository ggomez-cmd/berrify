import {
  extractInvoicesFromText,
  invoicesHavePositiveAmounts,
  type AccountRule,
  type ExtractedInvoice,
  type VendorAlias,
} from "./invoice-extract";
import { toRasterDataUrl } from "./invoice-image";
import { isThinOcrText } from "./ocr-thin";
import { supabase } from "./supabase";

export type ExtractEngine = "gemini" | "rules";

export type SkuAlias = {
  match_text: string;
  account: string;
  memo: string | null;
  category: AccountRule["category"];
};

export type InvoiceExtractExample = {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number;
  lines: Array<{
    code: string | null;
    description: string;
    amount: number;
    category: AccountRule["category"];
  }>;
  expenses: Array<{ account: string; amount: number; memo: string }>;
  ocr_snippet?: string;
  qbo_vendor_name?: string | null;
  supplier_id?: string | null;
};

export type ExtractInvoicesAfterOcrInput = {
  ocrText: string;
  image?: string | null;
  confidence?: number;
  restaurants?: Array<{ name: string; qbo_company_name: string; slug: string }>;
  vendorAliases: VendorAlias[];
  accountRules: AccountRule[];
  skuAliases?: SkuAlias[];
  examples?: InvoiceExtractExample[];
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
};

export type ExtractInvoicesAfterOcrResult = {
  invoices: ExtractedInvoice[];
  engine: ExtractEngine;
  error?: string;
};

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export { isThinOcrText };

export function extractEngineNote(engine: ExtractEngine, error?: string): string {
  switch (engine) {
    case "gemini":
      return "Gemini extract";
    case "rules": {
      const detail = error?.trim();
      return detail ? `Rules extract · ${detail}` : "Rules extract";
    }
    default: {
      const exhaustive: never = engine;
      return exhaustive;
    }
  }
}

function readExtractError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `Extract failed (${status})`;
}

export async function extractInvoicesAfterOcr(
  input: ExtractInvoicesAfterOcrInput,
): Promise<ExtractInvoicesAfterOcrResult> {
  const rulesInvoices = extractInvoicesFromText(
    input.ocrText,
    input.vendorAliases,
    input.accountRules,
  );
  const fallback = (error?: string): ExtractInvoicesAfterOcrResult => ({
    invoices: rulesInvoices,
    engine: "rules",
    ...(error ? { error } : {}),
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const getAccessToken = input.getAccessToken ?? defaultAccessToken;
  const attachImageFirst = Boolean(
    input.image &&
      (isThinOcrText(input.ocrText, input.confidence) || !invoicesHavePositiveAmounts(rulesInvoices)),
  );

  let rasterImage: string | null | undefined;

  const postExtract = async (attachImage: boolean): Promise<Response> => {
    const token = await getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const body: Record<string, unknown> = {
      ocr_text: input.ocrText,
      confidence: input.confidence,
      restaurants: input.restaurants ?? [],
      vendor_aliases: input.vendorAliases,
      account_rules: input.accountRules,
      sku_aliases: input.skuAliases ?? [],
      examples: input.examples ?? [],
    };
    if (attachImage && input.image) {
      if (rasterImage === undefined) {
        rasterImage = await toRasterDataUrl(input.image, fetchImpl);
      }
      body.image = rasterImage;
    }

    return fetchImpl("/api/invoice-extract", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  };

  try {
    let attachedImage = attachImageFirst;
    let response = await postExtract(attachedImage);
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const geminiInvoices = (payload as { invoices?: unknown } | null)?.invoices;
    const hasGemini =
      response.ok && Array.isArray(geminiInvoices) && geminiInvoices.length > 0;
    const geminiList = hasGemini ? (geminiInvoices as ExtractedInvoice[]) : [];

    if (
      input.image &&
      !attachedImage &&
      ((hasGemini && !invoicesHavePositiveAmounts(geminiList)) ||
        (response.ok && (!Array.isArray(geminiInvoices) || geminiInvoices.length === 0)))
    ) {
      attachedImage = true;
      response = await postExtract(true);
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (response.status === 503 || !response.ok) {
      return fallback(readExtractError(payload, response.status));
    }
    if (!payload || typeof payload !== "object") {
      return fallback("Gemini returned invalid JSON");
    }
    const invoices = (payload as { invoices?: unknown }).invoices;
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return fallback(readExtractError(payload, response.status) || "Gemini returned no invoices");
    }
    return { invoices: invoices as ExtractedInvoice[], engine: "gemini" };
  } catch {
    return fallback("Extract request failed");
  }
}
