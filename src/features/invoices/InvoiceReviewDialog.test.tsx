import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceStatus, InvoiceWithSupplier, QuickbooksAccount } from "../../lib/types";
import { InvoiceReviewDialog } from "./InvoiceReviewDialog";

const { accounts, connections, media, pages, noRows, saveInvoice, deleteInvoice, addPage, accountsQuery } = vi.hoisted(() => {
  const accounts: QuickbooksAccount[] = [
    {
      id: "acct-cc",
      org_id: "org-1",
      connection_id: "conn-semilla",
      list_id: "cc-1",
      full_name: "VISA x4007",
      account_number: "23300",
      account_type: "CreditCard",
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  return {
    accounts,
    connections: [{ id: "conn-semilla", restaurant_id: null, is_active: true }],
    media: { data: { image_data: null, image_mime: null, ocr_text: "Ending in 4007" }, isLoading: false },
    pages: { data: [] as [] },
    noRows: { data: [] as [] },
    saveInvoice: { mutateAsync: vi.fn(), isPending: false },
    deleteInvoice: { mutateAsync: vi.fn(), isPending: false },
    addPage: { mutateAsync: vi.fn(), isPending: false },
    accountsQuery: { loading: false },
  };
});

vi.mock("./hooks", () => ({
  useUpdateInvoice: () => saveInvoice,
  useDeleteInvoice: () => deleteInvoice,
  useAddInvoicePage: () => addPage,
  useInvoiceMedia: () => media,
  useInvoicePages: () => pages,
  fileToDataUrl: vi.fn(),
}));

vi.mock("../quickbooks/hooks", () => ({
  useQuickbooksConnections: () => ({ data: connections }),
  useQuickbooksOnlineConnections: () => noRows,
  useQuickbooksVendors: () => noRows,
  useQuickbooksAccounts: () => (accountsQuery.loading ? { data: undefined } : { data: accounts }),
}));

function invoice(status: InvoiceStatus): InvoiceWithSupplier {
  return {
    id: "inv-1",
    org_id: "org-1",
    restaurant_id: null,
    supplier_id: null,
    vendor_name: "Costco",
    invoice_number: "1001",
    invoice_date: "2026-10-01",
    due_date: "2026-10-15",
    terms: "Net 15",
    currency: "USD",
    subtotal: 4.99,
    tax: 0,
    total: 4.99,
    ap_account: "Accounts Payable",
    payment_kind: "bill",
    payment_account: null,
    payment_ref: null,
    status,
    source: "upload",
    whatsapp_from: null,
    whatsapp_group: null,
    whatsapp_message_id: null,
    telegram_from: null,
    telegram_message_id: null,
    telegram_media_group_id: null,
    caption: null,
    image_data: null,
    image_mime: null,
    ocr_text: "Ending in 4007",
    created_by: null,
    exported_at: null,
    quickbooks_txn_id: null,
    quickbooks_edit_sequence: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    suppliers: null,
    restaurants: null,
    invoice_lines: [
      {
        id: "line-1",
        org_id: "org-1",
        invoice_id: "inv-1",
        code: null,
        description: "Water",
        qty_ordered: 1,
        qty_shipped: 1,
        uom: null,
        pounds: null,
        unit_price: 4.99,
        amount: 4.99,
        category: "food",
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    invoice_expense_lines: [],
  };
}

function dialogElement(current: InvoiceWithSupplier) {
  return (
    <InvoiceReviewDialog
      open
      onOpenChange={() => undefined}
      invoice={current}
      suppliers={[]}
      restaurants={[]}
      restaurantAliases={[]}
      vendorAliases={[]}
      skuAliases={[]}
      accountRules={[]}
      extractExamples={[]}
    />
  );
}

function renderDialog(status: InvoiceStatus) {
  return render(dialogElement(invoice(status)));
}

describe("InvoiceReviewDialog", () => {
  it("leaves Paid with on Bill when a reviewed invoice is reopened", () => {
    renderDialog("reviewed");
    expect(screen.getByLabelText("Paid with")).toHaveValue("bill");
    expect(screen.queryByLabelText("Credit card account")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Check NO.")).not.toBeInTheDocument();
  });

  it("prefills Credit card from Ending in 4007 when the invoice is extracted", () => {
    renderDialog("extracted");
    expect(screen.getByLabelText("Paid with")).toHaveValue("credit_card");
    expect(screen.getByLabelText("Credit card account")).toHaveValue("23300 · VISA x4007");
  });

  it("does not loop while QuickBooks accounts are loading, then prefills the card", () => {
    accountsQuery.loading = true;
    // React logs this from useEffect and keeps rendering, so rethrow to fail instead of hanging.
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.includes("Maximum update depth")) throw new Error(text);
    });
    try {
      const current = invoice("extracted");
      const view = render(dialogElement(current));
      expect(screen.getByLabelText("Paid with")).toHaveValue("bill");
      accountsQuery.loading = false;
      view.rerender(dialogElement(current));
      expect(screen.getByLabelText("Paid with")).toHaveValue("credit_card");
      expect(screen.getByLabelText("Credit card account")).toHaveValue("23300 · VISA x4007");
      expect(errorSpy.mock.calls.flat().map(String).join("\n")).not.toContain("Maximum update depth");
    } finally {
      errorSpy.mockRestore();
      accountsQuery.loading = false;
    }
  }, 5000);
});
