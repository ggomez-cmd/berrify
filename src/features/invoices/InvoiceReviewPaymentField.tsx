import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import {
  INVOICE_PAYMENT_KIND_LABELS,
  isInvoicePaymentKind,
  paymentAccountsForKind,
  type InvoicePaymentDraft,
  type InvoicePaymentKind,
} from "../../lib/invoice-payment";
import type { QbAccountRow } from "../../lib/qb-account-match";
import { InvoiceReviewAccountField } from "./InvoiceReviewAccountField";

const KINDS: InvoicePaymentKind[] = ["bill", "credit_card", "check"];

export function InvoiceReviewPaymentField({
  value,
  onChange,
  accounts,
  note,
}: {
  value: InvoicePaymentDraft;
  onChange: (value: InvoicePaymentDraft) => void;
  accounts: QbAccountRow[];
  note: string | null;
}) {
  return (
    <div className="grid gap-2">
      <Field label="Paid with" htmlFor="inv-paid-with">
        <Select
          id="inv-paid-with"
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (isInvoicePaymentKind(kind)) onChange({ ...value, kind, account: "" });
          }}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {INVOICE_PAYMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Field>
      {value.kind === "credit_card" ? (
        <Field label="Credit card account" htmlFor="inv-paid-account">
          <InvoiceReviewAccountField
            id="inv-paid-account"
            className="min-w-0"
            accounts={paymentAccountsForKind("credit_card", accounts)}
            value={value.account}
            emptyLabel="Select credit card"
            onChange={(account) => onChange({ ...value, account })}
          />
        </Field>
      ) : null}
      {value.kind === "check" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Bank account" htmlFor="inv-paid-account">
            <InvoiceReviewAccountField
              id="inv-paid-account"
              className="min-w-0"
              accounts={paymentAccountsForKind("check", accounts)}
              value={value.account}
              emptyLabel="Select bank account"
              onChange={(account) => onChange({ ...value, account })}
            />
          </Field>
          <Field label="Check NO." htmlFor="inv-check-no">
            <Input
              id="inv-check-no"
              value={value.checkNumber}
              onChange={(event) => onChange({ ...value, checkNumber: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}
