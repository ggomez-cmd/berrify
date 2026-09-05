import { Camera, FileUp, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, THead, Td, Th } from "../../components/ui/table";
import {
  ACCOUNTS,
  DEFAULT_ACCOUNT_RULES,
  extractInvoiceFromText,
  type AccountRule,
  type VendorAlias,
} from "../../lib/invoice-extract";
import { formatMoney } from "../../lib/format";
import { ocrImage } from "../../lib/ocr";
import { isManager } from "../../lib/schedule";
import type { InvoiceSource, InvoiceWithSupplier } from "../../lib/types";
import { useSuppliers } from "../suppliers/hooks";
import { InvoiceReviewDialog } from "./InvoiceReviewDialog";
import { fileToDataUrl, useAccountRules, useCreateInvoice, useInvoices, useVendorAliases } from "./hooks";

function statusTone(status: InvoiceWithSupplier["status"]) {
  switch (status) {
    case "received":
      return "neutral" as const;
    case "extracted":
      return "warn" as const;
    case "reviewed":
      return "ok" as const;
    case "exported":
      return "ok" as const;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function InvoicesPage() {
  const { role } = useAuth();
  const { data: invoices = [], isLoading, error } = useInvoices();
  const { data: suppliers = [] } = useSuppliers();
  const { data: aliases = [] } = useVendorAliases();
  const { data: rules = [] } = useAccountRules();
  const create = useCreateInvoice();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<InvoiceWithSupplier | null>(null);

  if (!isManager(role)) {
    return <Navigate to="/" replace />;
  }

  const ingest = async (file: File, source: InvoiceSource, caption?: string) => {
    setBusy(true);
    setMessage("Reading invoice photo…");
    try {
      const { data, mime } = await fileToDataUrl(file);
      setMessage("Running OCR (trying rotations)…");
      const ocr = await ocrImage(data);
      const vendorAliases: VendorAlias[] = aliases.map((a) => ({
        match_text: a.match_text,
        supplier_id: a.supplier_id,
        qbo_vendor_name: a.qbo_vendor_name,
      }));
      const accountRules: AccountRule[] =
        rules.length > 0
          ? rules.map((r) => ({
              keyword: r.keyword,
              account: r.account,
              memo: r.memo,
              category: r.category,
            }))
          : DEFAULT_ACCOUNT_RULES;
      const extracted = extractInvoiceFromText(ocr.text || caption || "", vendorAliases, accountRules);
      const id = await create.mutateAsync({
        source,
        image_data: data,
        image_mime: mime,
        ocr_text: ocr.text,
        caption,
        vendor_name: extracted.vendor_name,
        supplier_id: extracted.supplier_id,
        invoice_number: extracted.invoice_number,
        invoice_date: extracted.invoice_date,
        due_date: extracted.due_date,
        terms: extracted.terms,
        subtotal: extracted.subtotal,
        tax: extracted.tax,
        total: extracted.total,
        ap_account: ACCOUNTS.ap,
        status: extracted.lines.length > 0 || extracted.total > 0 ? "extracted" : "received",
        lines: extracted.lines,
        expenses: extracted.expenses,
      });
      setMessage(
        `Digital bill created (${id.slice(0, 8)}). OCR rotation ${ocr.rotation}° · review the Expenses tab then export IIF.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not read invoice");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-mist">
        Photograph a Jose Santiago / CAN Enterprise invoice (or drop a photo forwarded from
        WhatsApp). Berrify OCRs SKUs, rolls them into QuickBooks Desktop expense accounts, and
        exports an IIF Bill — Expenses tab, not item lines.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="inline-flex">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingest(file, "camera");
              e.target.value = "";
            }}
          />
          <Button disabled={busy} onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}>
            <Camera className="size-4" />
            Take photo
          </Button>
        </label>
        <label className="inline-flex">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingest(file, "upload");
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
          >
            <FileUp className="size-4" />
            Upload photo
          </Button>
        </label>
        <label className="inline-flex">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingest(file, "whatsapp", "Forwarded from WhatsApp kitchen group");
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
          >
            <MessageCircle className="size-4" />
            WhatsApp photo
          </Button>
        </label>
      </div>

      {busy || message ? <p className="mb-3 text-sm text-mist">{message}</p> : null}
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-mist">Loading invoices…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Ref</Th>
              <Th>Vendor</Th>
              <Th>Date</Th>
              <Th>Total</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-mist">
                  No invoices yet. Photograph a supplier bill or import a WhatsApp photo.
                </Td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-white/3">
                  <Td className="font-medium">{invoice.invoice_number ?? invoice.id.slice(0, 8)}</Td>
                  <Td>{invoice.suppliers?.name ?? invoice.vendor_name ?? "—"}</Td>
                  <Td>{invoice.invoice_date ?? "—"}</Td>
                  <Td>{formatMoney(invoice.total)}</Td>
                  <Td className="capitalize">{invoice.source}</Td>
                  <Td>
                    <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                  </Td>
                  <Td>
                    <Button variant="subtle" onClick={() => setReviewing(invoice)}>
                      Review
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      ) : null}

      <InvoiceReviewDialog
        open={Boolean(reviewing)}
        onOpenChange={(next) => {
          if (!next) setReviewing(null);
        }}
        invoice={reviewing}
        suppliers={suppliers}
      />
    </div>
  );
}
