import { extractInvoicesFromText, type AccountRule, type ExtractedInvoice, type VendorAlias } from "./invoice-extract";
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
};

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export { isThinOcrText };

export function extractEngineNote(engine: ExtractEngine): string {
  switch (engine) {
    case "gemini":
      return "Gemini extract";
    case "rules":
      return "Rules extract";
    default: {
      const exhaustive: never = engine;
      return exhaustive;
    }
  }
}

export async function extractInvoicesAfterOcr(
  input: ExtractInvoicesAfterOcrInput,
): Promise<ExtractInvoicesAfterOcrResult> {
  const fallback = (): ExtractInvoicesAfterOcrResult => ({
    invoices: extractInvoicesFromText(input.ocrText, input.vendorAliases, input.accountRules),
    engine: "rules",
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const getAccessToken = input.getAccessToken ?? defaultAccessToken;

  try {
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
    if (input.image && isThinOcrText(input.ocrText, input.confidence)) {
      body.image = input.image;
    }

    const response = await fetchImpl("/api/invoice-extract", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(body),
    });

    if (response.status === 503) return fallback();
    if (!response.ok) return fallback();

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallback();
    const invoices = (payload as { invoices?: unknown }).invoices;
    if (!Array.isArray(invoices) || invoices.length === 0) return fallback();
    return { invoices: invoices as ExtractedInvoice[], engine: "gemini" };
  } catch {
    return fallback();
  }
}
