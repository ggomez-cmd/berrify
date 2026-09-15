import { ACCOUNTS, type ExpenseLine, type ExtractedSku, type InvoiceCategory } from "./invoice-extract";
import type { InvoiceExtractExample } from "./invoice-extract-api";

export type VendorAliasUpsert = {
  match_text: string;
  supplier_id: string;
  qbo_vendor_name: string;
};

export type SkuAliasUpsert = {
  match_text: string;
  account: string;
  memo: string | null;
  category: InvoiceCategory;
};

function normalizeMatch(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function vendorAliasFromReview(input: {
  supplierId: string | null;
  vendorName: string | null;
  qboVendorName: string;
}): VendorAliasUpsert | null {
  if (!input.supplierId) return null;
  const match = normalizeMatch(input.vendorName ?? input.qboVendorName);
  if (match.length < 3) return null;
  return {
    match_text: match,
    supplier_id: input.supplierId,
    qbo_vendor_name: input.qboVendorName.trim() || match,
  };
}

function accountForCategory(category: InvoiceCategory): string {
  switch (category) {
    case "food":
      return ACCOUNTS.food;
    case "beverage":
      return ACCOUNTS.beverage;
    case "kitchen":
      return ACCOUNTS.kitchen;
    case "cleaning":
      return ACCOUNTS.cleaning;
    case "tax":
      return ACCOUNTS.tax;
    case "other":
      return ACCOUNTS.food;
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

export function skuAliasesFromReview(
  lines: ExtractedSku[],
  expenses: ExpenseLine[],
): SkuAliasUpsert[] {
  const byMatch = new Map<string, SkuAliasUpsert>();

  for (const line of lines) {
    const raw = (line.code?.trim() || line.description).trim();
    const match = normalizeMatch(raw);
    if (match.length < 3) continue;
    byMatch.set(match, {
      match_text: match,
      account: accountForCategory(line.category),
      memo: line.description.trim() || null,
      category: line.category,
    });
  }

  for (const expense of expenses) {
    const match = normalizeMatch(expense.memo);
    if (match.length < 3) continue;
    byMatch.set(match, {
      match_text: match,
      account: expense.account,
      memo: expense.memo.trim() || null,
      category: "other",
    });
  }

  return [...byMatch.values()];
}

export const OCR_SNIPPET_MAX = 5000;
export const EXTRACT_EXAMPLE_LIMIT = 12;

const OVERLAP_STOPWORDS = new Set([
  "amount",
  "bill",
  "cantidad",
  "customer",
  "descripcion",
  "description",
  "desp",
  "due",
  "factura",
  "facturas",
  "fecha",
  "importe",
  "invoice",
  "municipal",
  "numero",
  "page",
  "pagina",
  "phone",
  "precio",
  "price",
  "puerto",
  "quantity",
  "rico",
  "ship",
  "sold",
  "subtotal",
  "tax",
  "tel",
  "terms",
  "territory",
  "total",
  "vendor",
]);

export type ExtractExampleCorrected = InvoiceExtractExample & {
  qbo_vendor_name?: string | null;
  supplier_id?: string | null;
};

export type ExtractExampleCandidate = {
  invoice_id?: string;
  supplier_id: string | null;
  restaurant_id: string | null;
  ocr_snippet: string;
  corrected: ExtractExampleCorrected;
};

export type ExtractExampleUpsert = {
  org_id: string;
  invoice_id: string;
  supplier_id: string | null;
  restaurant_id: string | null;
  ocr_snippet: string;
  corrected: ExtractExampleCorrected;
};

export type PickClosestExamplesHints = {
  aliases?: Array<{ match_text: string; supplier_id: string }>;
  restaurantId?: string | null;
  excludeInvoiceId?: string | null;
};

export function ocrSnippetFromText(ocrText: string, max = OCR_SNIPPET_MAX): string {
  return ocrText.trimStart().slice(0, max);
}

export function extractExampleUpsert(input: {
  orgId: string;
  invoiceId: string;
  supplierId: string | null;
  restaurantId: string | null;
  ocrText: string | null | undefined;
  qboVendorName: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number;
  lines: Array<{
    code: string | null;
    description: string;
    amount: number;
    category: InvoiceCategory;
  }>;
  expenses: Array<{ account: string; amount: number; memo: string | null }>;
}): ExtractExampleUpsert | null {
  const snippet = ocrSnippetFromText(input.ocrText ?? "");
  if (snippet.length === 0) return null;
  const qbo = input.qboVendorName.trim() || input.vendorName?.trim() || null;
  return {
    org_id: input.orgId,
    invoice_id: input.invoiceId,
    supplier_id: input.supplierId,
    restaurant_id: input.restaurantId,
    ocr_snippet: snippet,
    corrected: {
      vendor_name: input.vendorName,
      invoice_number: input.invoiceNumber,
      invoice_date: input.invoiceDate,
      total: Number(input.total),
      qbo_vendor_name: qbo,
      supplier_id: input.supplierId,
      lines: input.lines.map((line) => ({
        code: line.code,
        description: line.description,
        amount: Number(line.amount),
        category: line.category,
      })),
      expenses: input.expenses.map((line) => ({
        account: line.account,
        amount: Number(line.amount),
        memo: line.memo ?? "",
      })),
    },
  };
}

function overlapTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const matches = text.toLowerCase().match(/[a-záéíóúñ]{4,}|[0-9]{3,}/gi) ?? [];
  for (const raw of matches) {
    const token = raw.toLowerCase();
    if (OVERLAP_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function overlapScore(query: Set<string>, snippet: string): number {
  if (query.size === 0) return 0;
  const haystack = overlapTokens(snippet);
  let score = 0;
  for (const token of query) {
    if (haystack.has(token)) score += 1;
  }
  return score;
}

function letterheadHits(haystack: string, candidate: ExtractExampleCandidate): boolean {
  const names = [candidate.corrected.vendor_name, candidate.corrected.qbo_vendor_name];
  for (const name of names) {
    const match = normalizeMatch(name ?? "");
    if (match.length >= 3 && haystack.includes(match)) return true;
  }
  return false;
}

function toExtractExample(candidate: ExtractExampleCandidate): InvoiceExtractExample {
  const corrected = candidate.corrected;
  return {
    vendor_name: corrected.vendor_name,
    invoice_number: corrected.invoice_number,
    invoice_date: corrected.invoice_date,
    total: Number(corrected.total),
    lines: corrected.lines ?? [],
    expenses: (corrected.expenses ?? []).map((line) => ({
      account: line.account,
      amount: Number(line.amount),
      memo: line.memo ?? "",
    })),
    ocr_snippet: candidate.ocr_snippet,
    qbo_vendor_name: corrected.qbo_vendor_name ?? null,
    supplier_id: corrected.supplier_id ?? candidate.supplier_id,
  };
}

function rankByOverlap(
  ocrText: string,
  candidates: ExtractExampleCandidate[],
  limit: number,
): InvoiceExtractExample[] {
  const query = overlapTokens(ocrText);
  return candidates
    .map((candidate) => ({ candidate, score: overlapScore(query, candidate.ocr_snippet) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => toExtractExample(row.candidate));
}

export function pickClosestExamples(
  ocrText: string,
  candidates: ExtractExampleCandidate[],
  limit = EXTRACT_EXAMPLE_LIMIT,
  hints: PickClosestExamplesHints = {},
): InvoiceExtractExample[] {
  const haystack = ocrText.toLowerCase();
  const pool = candidates.filter((candidate) =>
    hints.excludeInvoiceId ? candidate.invoice_id !== hints.excludeInvoiceId : true,
  );
  if (pool.length === 0 || limit <= 0) return [];

  const supplierIds = new Set<string>();
  for (const alias of hints.aliases ?? []) {
    const match = alias.match_text.trim().toLowerCase();
    if (match.length >= 3 && haystack.includes(match) && alias.supplier_id) {
      supplierIds.add(alias.supplier_id);
    }
  }
  for (const candidate of pool) {
    if (candidate.supplier_id && letterheadHits(haystack, candidate)) {
      supplierIds.add(candidate.supplier_id);
    }
  }
  if (supplierIds.size > 0) {
    const matched = pool.filter(
      (candidate) => candidate.supplier_id && supplierIds.has(candidate.supplier_id),
    );
    const ranked = rankByOverlap(ocrText, matched, limit);
    if (ranked.length > 0) return ranked;
    return matched.slice(0, limit).map(toExtractExample);
  }

  if (hints.restaurantId) {
    const sameRestaurant = pool.filter((candidate) => candidate.restaurant_id === hints.restaurantId);
    if (sameRestaurant.length > 0) {
      const ranked = rankByOverlap(ocrText, sameRestaurant, limit);
      if (ranked.length > 0) return ranked;
      return sameRestaurant.slice(0, limit).map(toExtractExample);
    }
  }

  return rankByOverlap(ocrText, pool, limit);
}
