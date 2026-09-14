import { ACCOUNTS, type ExpenseLine, type ExtractedSku, type InvoiceCategory } from "./invoice-extract";

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

export type ReviewedExtractExample = {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number;
  lines: Array<{
    code: string | null;
    description: string;
    amount: number;
    category: InvoiceCategory;
  }>;
  expenses: Array<{ account: string; amount: number; memo: string }>;
};

export function reviewedExamplesForVendor<
  T extends {
    status: string;
    supplier_id: string | null;
    vendor_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    total: number;
    invoice_lines?: Array<{
      code: string | null;
      description: string;
      amount: number;
      category: InvoiceCategory;
    }>;
    invoice_expense_lines?: Array<{ account: string; amount: number; memo: string | null }>;
  },
>(
  invoices: T[],
  ocrText: string,
  aliases: Array<{ match_text: string; supplier_id: string }>,
  limit = 5,
): ReviewedExtractExample[] {
  const haystack = ocrText.toLowerCase();
  const matched = aliases.find((alias) => haystack.includes(alias.match_text.toLowerCase()));
  if (!matched) return [];

  return invoices
    .filter(
      (invoice) =>
        (invoice.status === "reviewed" || invoice.status === "exported") &&
        invoice.supplier_id === matched.supplier_id,
    )
    .slice(0, limit)
    .map((invoice) => ({
      vendor_name: invoice.vendor_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      total: Number(invoice.total),
      lines: (invoice.invoice_lines ?? []).map((line) => ({
        code: line.code,
        description: line.description,
        amount: Number(line.amount),
        category: line.category,
      })),
      expenses: (invoice.invoice_expense_lines ?? []).map((line) => ({
        account: line.account,
        amount: Number(line.amount),
        memo: line.memo ?? "",
      })),
    }));
}
