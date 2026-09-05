import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import type { ExpenseLine, ExtractedSku } from "../../lib/invoice-extract";
import { supabase } from "../../lib/supabase";
import type {
  AccountRuleRow,
  Invoice,
  InvoiceExpenseLine,
  InvoiceLine,
  InvoiceSource,
  InvoiceStatus,
  InvoiceWithSupplier,
  VendorAliasRow,
} from "../../lib/types";

export function useInvoices() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["invoices", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, suppliers(id, name), invoice_lines(*), invoice_expense_lines(*)")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(sortInvoiceChildren) as InvoiceWithSupplier[];
    },
  });
}

export function useVendorAliases() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["vendor_aliases", org?.id],
    enabled: Boolean(org?.id),
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

export function useAccountRules() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["account_rules", org?.id],
    enabled: Boolean(org?.id),
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
    }) => {
      const { error } = await supabase
        .from("invoices")
        .update({
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
        })
        .eq("id", input.invoice.id);
      if (error) throw error;

      await replaceInvoiceChildren(
        input.invoice.org_id,
        input.invoice.id,
        input.lines,
        input.expenses,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
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
  if (delLines) throw delLines;
  const { error: delExp } = await supabase
    .from("invoice_expense_lines")
    .delete()
    .eq("invoice_id", invoiceId);
  if (delExp) throw delExp;

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
    if (error) throw error;
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
    if (error) throw error;
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
