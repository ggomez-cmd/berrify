import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import {
  ACCOUNTS,
  invoiceTotals,
  rollupExpenses,
  toQuickBooksBillCsv,
  toQuickBooksBillIif,
  type ExpenseLine,
  type ExtractedSku,
} from "../../lib/invoice-extract";
import { formatMoney } from "../../lib/format";
import { restaurantFileSlug } from "../../lib/restaurant-route";
import type { InvoiceCategory, InvoiceWithSupplier, Restaurant, Supplier } from "../../lib/types";
import { useUpdateInvoice } from "./hooks";

const CATEGORIES: InvoiceCategory[] = ["food", "kitchen", "cleaning", "beverage", "tax", "other"];

function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoiceReviewDialog({
  open,
  onOpenChange,
  invoice,
  suppliers,
  restaurants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceWithSupplier | null;
  suppliers: Supplier[];
  restaurants: Restaurant[];
}) {
  const save = useUpdateInvoice();
  const [restaurantId, setRestaurantId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [due, setDue] = useState("");
  const [terms, setTerms] = useState("Net 15");
  const [tax, setTax] = useState(0);
  const [lines, setLines] = useState<ExtractedSku[]>([]);
  const [expenses, setExpenses] = useState<ExpenseLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !invoice) return;
    setRestaurantId(invoice.restaurant_id ?? "");
    setSupplierId(invoice.supplier_id ?? "");
    setVendorName(invoice.vendor_name ?? "");
    setNumber(invoice.invoice_number ?? "");
    setDate(invoice.invoice_date ?? "");
    setDue(invoice.due_date ?? "");
    setTerms(invoice.terms || "Net 15");
    setTax(Number(invoice.tax));
    const nextLines = invoice.invoice_lines.map((l) => ({
      code: l.code,
      description: l.description,
      qty_ordered: Number(l.qty_ordered),
      qty_shipped: Number(l.qty_shipped),
      uom: l.uom,
      pounds: l.pounds == null ? null : Number(l.pounds),
      unit_price: Number(l.unit_price),
      amount: Number(l.amount),
      category: l.category,
    }));
    setLines(nextLines);
    setExpenses(
      invoice.invoice_expense_lines.length > 0
        ? invoice.invoice_expense_lines.map((e) => ({
            account: e.account,
            amount: Number(e.amount),
            memo: e.memo ?? "",
          }))
        : rollupExpenses(nextLines, Number(invoice.tax)),
    );
    setError(null);
  }, [open, invoice]);

  const totals = useMemo(() => invoiceTotals(lines, tax), [lines, tax]);

  if (!invoice) return null;

  const persist = async (status: "reviewed" | "exported", exportedAt?: string) => {
    setError(null);
    try {
      await save.mutateAsync({
        invoice,
        lines,
        expenses,
        restaurant_id: restaurantId || null,
        supplier_id: supplierId || null,
        vendor_name: vendorName || null,
        invoice_number: number,
        invoice_date: date,
        due_date: due,
        terms,
        tax,
        subtotal: totals.subtotal,
        total: totals.total,
        status,
        exported_at: exportedAt ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save invoice");
      throw err;
    }
  };

  const vendor =
    suppliers.find((s) => s.id === supplierId)?.name ??
    invoice.suppliers?.name ??
    invoice.vendor_name ??
    "Unknown vendor";

  const exportPayload = {
    vendor,
    invoiceNumber: number || invoice.id.slice(0, 8),
    invoiceDate: date || new Date().toISOString().slice(0, 10),
    dueDate: due || date || new Date().toISOString().slice(0, 10),
    terms,
    apAccount: invoice.ap_account || ACCOUNTS.ap,
    expenses,
    total: totals.total,
  };

  const books = restaurants.find((r) => r.id === restaurantId);
  const filePrefix = books ? `${restaurantFileSlug(books)}-` : "";

  const exportIif = async () => {
    downloadText(
      `${filePrefix}qbd-bill-${exportPayload.invoiceNumber}.iif`,
      toQuickBooksBillIif(exportPayload),
      "text/plain",
    );
    await persist("exported", new Date().toISOString());
    onOpenChange(false);
  };

  const exportCsv = async () => {
    downloadText(
      `${filePrefix}qbd-bill-${exportPayload.invoiceNumber}.csv`,
      toQuickBooksBillCsv(exportPayload),
      "text/csv",
    );
    await persist("exported", new Date().toISOString());
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={invoice.invoice_number ? `Bill ${invoice.invoice_number}` : "Review invoice"}
      description="Confirm SKUs and the QuickBooks Desktop Expenses tab, then export an IIF bill."
      className="max-h-[92vh] w-[min(1100px,calc(100vw-1.5rem))] overflow-y-auto"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {invoice.image_data ? (
          <img
            src={invoice.image_data}
            alt="Invoice photo"
            className="max-h-80 w-full rounded-xl border border-white/10 object-contain bg-black/20"
          />
        ) : (
          <div className="grid min-h-40 place-items-center rounded-xl border border-white/10 text-sm text-mist">
            No photo attached
          </div>
        )}
        <div className="grid gap-2">
          <Field label="Restaurant / QBO books" htmlFor="inv-rest">
            <Select id="inv-rest" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
              <option value="">Select restaurant</option>
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name} · {restaurant.qbo_company_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="QuickBooks vendor" htmlFor="inv-sup">
            <Select id="inv-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select vendor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Print name" htmlFor="inv-print">
            <Input id="inv-print" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </Field>
          <Field label="Ref No." htmlFor="inv-no">
            <Input id="inv-no" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date" htmlFor="inv-date">
              <Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due" htmlFor="inv-due">
              <Input id="inv-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <Field label="Terms" htmlFor="inv-terms">
            <Input id="inv-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">SKU lines</h3>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={`${line.code ?? "sku"}-${i}`} className="grid grid-cols-12 gap-1.5">
                <Input
                  className="col-span-5"
                  value={line.description}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, idx) => (idx === i ? { ...r, description: e.target.value } : r)),
                    )
                  }
                />
                <Input
                  className="col-span-2"
                  type="number"
                  title="Qty shipped (Desp)"
                  value={line.qty_shipped}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, idx) => {
                        if (idx !== i) return r;
                        const qty_shipped = Number(e.target.value);
                        return { ...r, qty_shipped, amount: qty_shipped * r.unit_price };
                      }),
                    )
                  }
                />
                <Input
                  className="col-span-2"
                  type="number"
                  value={line.amount}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, idx) => (idx === i ? { ...r, amount: Number(e.target.value) } : r)),
                    )
                  }
                />
                <Select
                  className="col-span-2"
                  value={line.category}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, idx) =>
                        idx === i ? { ...r, category: e.target.value as InvoiceCategory } : r,
                      ),
                    )
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="subtle"
                  className="col-span-1 px-2"
                  onClick={() => setLines((rows) => rows.filter((_, idx) => idx !== i))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() =>
                setLines((rows) => [
                  ...rows,
                  {
                    code: null,
                    description: "",
                    qty_ordered: 0,
                    qty_shipped: 1,
                    uom: "CS",
                    pounds: null,
                    unit_price: 0,
                    amount: 0,
                    category: "food",
                  },
                ])
              }
            >
              Add SKU
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">QuickBooks expenses</h3>
            <Button variant="subtle" onClick={() => setExpenses(rollupExpenses(lines, tax))}>
              Recalc rollup
            </Button>
          </div>
          <div className="space-y-2">
            {expenses.map((line, i) => (
              <div key={`${line.account}-${i}`} className="grid grid-cols-12 gap-1.5">
                <Input
                  className="col-span-6"
                  value={line.account}
                  onChange={(e) =>
                    setExpenses((rows) =>
                      rows.map((r, idx) => (idx === i ? { ...r, account: e.target.value } : r)),
                    )
                  }
                />
                <Input
                  className="col-span-3"
                  type="number"
                  value={line.amount}
                  onChange={(e) =>
                    setExpenses((rows) =>
                      rows.map((r, idx) => (idx === i ? { ...r, amount: Number(e.target.value) } : r)),
                    )
                  }
                />
                <Input
                  className="col-span-3"
                  value={line.memo}
                  onChange={(e) =>
                    setExpenses((rows) =>
                      rows.map((r, idx) => (idx === i ? { ...r, memo: e.target.value } : r)),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-mist">
            Desktop Bill · A/P {invoice.ap_account || ACCOUNTS.ap} · Expenses tab only
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Field label="Tax (Municipal + PR Territory)" htmlFor="inv-tax">
          <Input
            id="inv-tax"
            type="number"
            value={tax}
            onChange={(e) => setTax(Number(e.target.value))}
          />
        </Field>
        <div>
          <p className="mb-1.5 text-xs text-mist">Subtotal</p>
          <p className="py-2">{formatMoney(totals.subtotal)}</p>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-mist">Total</p>
          <p className="py-2 font-semibold">{formatMoney(totals.total)}</p>
        </div>
      </div>

      {invoice.ocr_text ? (
        <details className="mt-3 text-xs text-mist">
          <summary>OCR text</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">{invoice.ocr_text}</pre>
        </details>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button variant="ghost" disabled={save.isPending} onClick={() => void persist("reviewed")}>
          Save review
        </Button>
        <Button variant="ghost" disabled={save.isPending} onClick={() => void exportCsv()}>
          Export CSV
        </Button>
        <Button disabled={save.isPending} onClick={() => void exportIif()}>
          Export Desktop IIF
        </Button>
      </div>
    </Dialog>
  );
}
