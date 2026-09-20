import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import type { ExpenseLine, ExtractedSku } from "../../lib/invoice-extract";
import {
  extractExampleUpsert,
  skuAliasesFromReview,
  vendorAliasFromReview,
} from "../../lib/invoice-review-memory";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import { toThrownError } from "../../lib/thrown-error";
import type {
  AccountRuleRow,
  Invoice,
  InvoiceExpenseLine,
  InvoiceLine,
  InvoiceExtractExampleRow,
  InvoicePage,
  InvoiceSkuAliasRow,
  InvoiceSource,
  InvoiceStatus,
  InvoiceWithSupplier,
  Restaurant,
  RestaurantAliasRow,
  VendorAliasRow,
} from "../../lib/types";

const INVOICE_LIST_SELECT =
  "id, org_id, restaurant_id, supplier_id, vendor_name, invoice_number, invoice_date, due_date, terms, currency, subtotal, tax, total, ap_account, status, source, whatsapp_from, whatsapp_group, whatsapp_message_id, telegram_from, telegram_message_id, caption, image_mime, created_by, exported_at, quickbooks_txn_id, quickbooks_edit_sequence, created_at, updated_at, suppliers(id, name), restaurants(id, name, qbo_company_name, slug), invoice_lines(*), invoice_expense_lines(*)";

function throwSaveError(error: unknown): never {
  throw toThrownError(error, "Could not save invoice");
}

export function useInvoices() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["invoices", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(INVOICE_LIST_SELECT)
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) =>
        sortInvoiceChildren({
          ...(row as unknown as InvoiceWithSupplier),
          image_data: null,
          ocr_text: null,
        }),
      );
    },
  });
}

export function useInvoicePages(invoiceId: string | null) {
  return useQuery({
    queryKey: ["invoice_pages", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_pages")
        .select("id, org_id, invoice_id, sort_order, image_data, image_mime, created_at")
        .eq("invoice_id", invoiceId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as InvoicePage[];
    },
  });
}

export function useAddInvoicePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      orgId: string;
      invoiceId: string;
      sortOrder: number;
      image_data: string;
      image_mime: string;
    }) => {
      const { error } = await supabase.from("invoice_pages").insert({
        org_id: input.orgId,
        invoice_id: input.invoiceId,
        sort_order: input.sortOrder,
        image_data: input.image_data,
        image_mime: input.image_mime,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["invoice_pages", input.invoiceId] });
    },
  });
}

export function useInvoiceMedia(invoiceId: string | null) {
  return useQuery({
    queryKey: ["invoice_media", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("image_data, image_mime, ocr_text")
        .eq("id", invoiceId!)
        .single();
      if (error) throw error;
      return data as Pick<Invoice, "image_data" | "image_mime" | "ocr_text">;
    },
  });
}

export function useVendorAliases() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["vendor_aliases", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_aliases")
        .select("*")
        .eq("org_id", org!.id);
      if (error) throw error;
      return (data ?? []) as VendorAliasRow[];
    },
  });
}

export function useRestaurants() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["restaurants", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("org_id", org!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Restaurant[];
    },
  });
}

export function useRestaurantAliases() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["restaurant_aliases", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurant_aliases")
        .select("*")
        .eq("org_id", org!.id);
      if (error) throw error;
      return (data ?? []) as RestaurantAliasRow[];
    },
  });
}

export function useInvoiceExtractExamples() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["invoice_extract_examples", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_extract_examples")
        .select("*")
        .eq("org_id", org!.id)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as InvoiceExtractExampleRow[];
    },
  });
}

export function useSkuAliases() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["invoice_sku_aliases", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_sku_aliases")
        .select("*")
        .eq("org_id", org!.id);
      if (error) throw error;
      return (data ?? []) as InvoiceSkuAliasRow[];
    },
  });
}

export function useAccountRules() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["account_rules", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_rules")
        .select("*")
        .eq("org_id", org!.id);
      if (error) throw error;
      return (data ?? []) as AccountRuleRow[];
    },
  });
}

export function useCreateInvoice() {
  const { org, user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      source: InvoiceSource;
      image_data: string | null;
      image_mime: string | null;
      ocr_text: string | null;
      caption?: string;
      whatsapp_from?: string;
      whatsapp_group?: string;
      restaurant_id: string | null;
      vendor_name: string | null;
      supplier_id: string | null;
      invoice_number: string | null;
      invoice_date: string | null;
      due_date: string | null;
      terms: string;
      subtotal: number;
      tax: number;
      total: number;
      ap_account: string;
      status: InvoiceStatus;
      lines: ExtractedSku[];
      expenses: ExpenseLine[];
    }) => {
      if (!org) throw new Error("No organization");
      const { data, error } = await supabase
        .from("invoices")
        .insert({
          org_id: org.id,
          restaurant_id: input.restaurant_id,
          supplier_id: input.supplier_id,
          vendor_name: input.vendor_name,
          invoice_number: input.invoice_number,
          invoice_date: input.invoice_date,
          due_date: input.due_date,
          terms: input.terms,
          subtotal: input.subtotal,
          tax: input.tax,
          total: input.total,
          ap_account: input.ap_account,
          status: input.status,
          source: input.source,
          caption: input.caption ?? null,
          whatsapp_from: input.whatsapp_from ?? null,
          whatsapp_group: input.whatsapp_group ?? null,
          image_data: input.image_data,
          image_mime: input.image_mime,
          ocr_text: input.ocr_text,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Failed to create invoice");

      await replaceInvoiceChildren(org.id, data.id, input.lines, input.expenses);
      return data.id as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["invoice_media", id] });
    },
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      invoice: Invoice;
      lines: Array<
        Pick<
          InvoiceLine,
          | "code"
          | "description"
          | "qty_ordered"
          | "qty_shipped"
          | "uom"
          | "pounds"
          | "unit_price"
          | "amount"
          | "category"
        >
      >;
      expenses: Array<Pick<InvoiceExpenseLine, "account" | "amount" | "memo">>;
      restaurant_id: string | null;
      supplier_id: string | null;
      vendor_name: string | null;
      invoice_number: string;
      invoice_date: string;
      due_date: string;
      terms: string;
      tax: number;
      subtotal: number;
      total: number;
      status: InvoiceStatus;
      exported_at?: string | null;
      ocr_text?: string | null;
    }) => {
      const { error } = await supabase
        .from("invoices")
        .update({
          restaurant_id: input.restaurant_id,
          supplier_id: input.supplier_id,
          vendor_name: input.vendor_name,
          invoice_number: input.invoice_number || null,
          invoice_date: input.invoice_date || null,
          due_date: input.due_date || null,
          terms: input.terms,
          tax: input.tax,
          subtotal: input.subtotal,
          total: input.total,
          status: input.status,
          exported_at: input.exported_at ?? input.invoice.exported_at,
          ...(input.ocr_text !== undefined ? { ocr_text: input.ocr_text } : {}),
        })
        .eq("id", input.invoice.id);
      if (error) throwSaveError(error);

      await replaceInvoiceChildren(
        input.invoice.org_id,
        input.invoice.id,
        input.lines,
        input.expenses,
      );

      if (input.status === "reviewed" || input.status === "exported") {
        await persistReviewMemory(input);
      }
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["invoice_media", input.invoice.id] });
      void qc.invalidateQueries({ queryKey: ["vendor_aliases"] });
      void qc.invalidateQueries({ queryKey: ["invoice_sku_aliases"] });
      void qc.invalidateQueries({ queryKey: ["invoice_extract_examples"] });
    },
  });
}

async function persistReviewMemory(input: {
  invoice: Invoice;
  lines: Array<
    Pick<
      InvoiceLine,
      | "code"
      | "description"
      | "qty_ordered"
      | "qty_shipped"
      | "uom"
      | "pounds"
      | "unit_price"
      | "amount"
      | "category"
    >
  >;
  expenses: Array<Pick<InvoiceExpenseLine, "account" | "amount" | "memo">>;
  restaurant_id: string | null;
  supplier_id: string | null;
  vendor_name: string | null;
  invoice_number: string;
  invoice_date: string;
  total: number;
  ocr_text?: string | null;
}) {
  const { data: supplier } = input.supplier_id
    ? await supabase.from("suppliers").select("name").eq("id", input.supplier_id).maybeSingle()
    : { data: null };
  const vendorAlias = vendorAliasFromReview({
    supplierId: input.supplier_id,
    vendorName: input.vendor_name,
    qboVendorName: supplier?.name ?? input.vendor_name ?? "",
  });
  if (vendorAlias) {
    const { error } = await supabase.from("vendor_aliases").upsert(
      {
        org_id: input.invoice.org_id,
        match_text: vendorAlias.match_text,
        supplier_id: vendorAlias.supplier_id,
        qbo_vendor_name: vendorAlias.qbo_vendor_name,
      },
      { onConflict: "org_id,match_text" },
    );
    if (error) throwSaveError(error);
  }

  const skuAliases = skuAliasesFromReview(
    input.lines.map((line) => ({
      code: line.code ?? null,
      description: line.description,
      qty_ordered: line.qty_ordered ?? 0,
      qty_shipped: line.qty_shipped ?? 0,
      uom: line.uom ?? null,
      pounds: line.pounds ?? null,
      unit_price: line.unit_price ?? 0,
      amount: line.amount,
      category: line.category ?? "food",
    })),
    input.expenses.map((line) => ({
      account: line.account,
      amount: line.amount,
      memo: line.memo ?? "",
    })),
  );
  if (skuAliases.length > 0) {
    const { error } = await supabase.from("invoice_sku_aliases").upsert(
      skuAliases.map((alias) => ({
        org_id: input.invoice.org_id,
        match_text: alias.match_text,
        account: alias.account,
        memo: alias.memo,
        category: alias.category,
      })),
      { onConflict: "org_id,match_text" },
    );
    if (error) throwSaveError(error);
  }

  let ocrText = input.ocr_text;
  if (ocrText === undefined) {
    const { data, error } = await supabase
      .from("invoices")
      .select("ocr_text")
      .eq("id", input.invoice.id)
      .maybeSingle();
    if (error) throwSaveError(error);
    ocrText = (data?.ocr_text as string | null | undefined) ?? null;
  }
  const example = extractExampleUpsert({
    orgId: input.invoice.org_id,
    invoiceId: input.invoice.id,
    supplierId: input.supplier_id,
    restaurantId: input.restaurant_id,
    ocrText,
    qboVendorName: supplier?.name ?? input.vendor_name ?? "",
    vendorName: input.vendor_name,
    invoiceNumber: input.invoice_number || null,
    invoiceDate: input.invoice_date || null,
    total: input.total,
    lines: input.lines.map((line) => ({
      code: line.code ?? null,
      description: line.description,
      amount: line.amount,
      category: line.category ?? "food",
    })),
    expenses: input.expenses.map((line) => ({
      account: line.account,
      amount: line.amount,
      memo: line.memo ?? "",
    })),
  });
  if (!example) return;
  const { error: exampleError } = await supabase.from("invoice_extract_examples").upsert(example, {
    onConflict: "invoice_id",
  });
  if (exampleError) throwSaveError(exampleError);
}

async function replaceInvoiceChildren(
  orgId: string,
  invoiceId: string,
  lines: Array<{
    code?: string | null;
    description: string;
    qty_ordered?: number;
    qty_shipped?: number;
    uom?: string | null;
    pounds?: number | null;
    unit_price?: number;
    amount: number;
    category?: InvoiceLine["category"];
  }>,
  expenses: Array<{ account: string; amount: number; memo?: string | null }>,
) {
  const { error: delLines } = await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId);
  if (delLines) throwSaveError(delLines);
  const { error: delExp } = await supabase
    .from("invoice_expense_lines")
    .delete()
    .eq("invoice_id", invoiceId);
  if (delExp) throwSaveError(delExp);

  if (lines.length > 0) {
    const { error } = await supabase.from("invoice_lines").insert(
      lines.map((line) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        code: line.code ?? null,
        description: line.description,
        qty_ordered: line.qty_ordered ?? 0,
        qty_shipped: line.qty_shipped ?? 0,
        uom: line.uom ?? null,
        pounds: line.pounds ?? null,
        unit_price: line.unit_price ?? 0,
        amount: line.amount,
        category: line.category ?? "food",
      })),
    );
    if (error) throwSaveError(error);
  }

  if (expenses.length > 0) {
    const { error } = await supabase.from("invoice_expense_lines").insert(
      expenses.map((line, index) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        account: line.account,
        amount: line.amount,
        memo: line.memo ?? "",
        sort_order: index,
      })),
    );
    if (error) throwSaveError(error);
  }
}

function sortInvoiceChildren(invoice: InvoiceWithSupplier): InvoiceWithSupplier {
  return {
    ...invoice,
    invoice_lines: [...(invoice.invoice_lines ?? [])],
    invoice_expense_lines: [...(invoice.invoice_expense_lines ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  };
}

export async function fileToDataUrl(file: File): Promise<{ data: string; mime: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { data, mime: file.type || "image/jpeg" };
}
