import { qbAccountLabel, qbPaymentAccountType, type QbAccountRow } from "./qb-account-match";

export type InvoicePaymentKind = "bill" | "credit_card" | "check";

export type InvoicePayment =
  | { kind: "bill" }
  | { kind: "credit_card"; account: string }
  | { kind: "check"; account: string; checkNumber: string | null };

export type PaidInvoicePayment = Exclude<InvoicePayment, { kind: "bill" }>;

export type InvoicePaymentByKind = { [K in InvoicePaymentKind]: Extract<InvoicePayment, { kind: K }> };

/** What Review edits before Send. Card and check drafts may have no account yet. */
export type InvoicePaymentDraft = {
  kind: InvoicePaymentKind;
  account: string;
  checkNumber: string;
};

export type InvoicePaymentColumns = {
  payment_kind: InvoicePaymentKind;
  payment_account: string | null;
  payment_ref: string | null;
};

export const DEFAULT_INVOICE_PAYMENT_KIND: InvoicePaymentKind = "bill";

export const INVOICE_PAYMENT_KIND_LABELS: Record<InvoicePaymentKind, string> = {
  bill: "Bill (pay later)",
  credit_card: "Credit card",
  check: "Bank or check",
};

/** The QuickBooks transaction each kind becomes, as the bookkeeper calls it. */
export const INVOICE_PAYMENT_TXN_LABELS: Record<InvoicePaymentKind, string> = {
  bill: "bill",
  credit_card: "credit card charge",
  check: "check",
};

export function isInvoicePaymentKind(value: unknown): value is InvoicePaymentKind {
  return value === "bill" || value === "credit_card" || value === "check";
}

export function parseInvoicePayment(row: {
  payment_kind?: string | null;
  payment_account?: string | null;
  payment_ref?: string | null;
}): InvoicePayment | { error: string } {
  const kind = row.payment_kind ?? DEFAULT_INVOICE_PAYMENT_KIND;
  const account = row.payment_account?.trim() ?? "";
  switch (kind) {
    case "bill":
      return { kind: "bill" };
    case "credit_card":
      if (!account) return { error: "Pick the credit card account this receipt was paid with" };
      return { kind: "credit_card", account };
    case "check":
      if (!account) return { error: "Pick the bank account this receipt was paid from" };
      return { kind: "check", account, checkNumber: row.payment_ref?.trim() || null };
    default:
      return { error: `Unknown payment type "${kind}"` };
  }
}

export function draftFromInvoiceColumns(row: {
  payment_kind?: string | null;
  payment_account?: string | null;
  payment_ref?: string | null;
}): InvoicePaymentDraft {
  return {
    kind: isInvoicePaymentKind(row.payment_kind) ? row.payment_kind : DEFAULT_INVOICE_PAYMENT_KIND,
    account: row.payment_account?.trim() ?? "",
    checkNumber: row.payment_ref?.trim() ?? "",
  };
}

export function invoicePaymentColumns(draft: InvoicePaymentDraft): InvoicePaymentColumns {
  switch (draft.kind) {
    case "bill":
      return { payment_kind: "bill", payment_account: null, payment_ref: null };
    case "credit_card":
      return { payment_kind: "credit_card", payment_account: draft.account.trim() || null, payment_ref: null };
    case "check":
      return {
        payment_kind: "check",
        payment_account: draft.account.trim() || null,
        payment_ref: draft.checkNumber.trim() || null,
      };
    default: {
      const exhaustive: never = draft.kind;
      return exhaustive;
    }
  }
}

const PAYMENT_ACCOUNT_TYPE: Record<PaidInvoicePayment["kind"], ReturnType<typeof qbPaymentAccountType>> = {
  credit_card: "credit_card",
  check: "bank",
};

export function paymentAccountsForKind(
  kind: PaidInvoicePayment["kind"],
  accounts: QbAccountRow[],
): QbAccountRow[] {
  const wanted = PAYMENT_ACCOUNT_TYPE[kind];
  return accounts.filter((row) => row.is_active && qbPaymentAccountType(row) === wanted);
}

export type InvoicePaymentHint =
  | { kind: "none" }
  | { kind: "card"; digits: string }
  | { kind: "ath" };

// Card digits are 4-5 digits that are not part of a money amount or a longer number.
const CARD_DIGITS = String.raw`(?<![\d$.,])(\d{4,5})(?![\d.,]\d)`;

// pdf.js joins a receipt's text items with spaces, so a label and its digits can sit
// a few words apart on one line. Each window is bounded so an unrelated number
// elsewhere on the receipt cannot pair with the label.
const CARD_DIGIT_PATTERNS = [
  new RegExp(String.raw`\bending\s+in\b[^\d]{0,40}?${CARD_DIGITS}`, "i"),
  new RegExp(String.raw`[x*•]{2,}\s*-?\s*${CARD_DIGITS}`, "i"),
  new RegExp(String.raw`\bx${CARD_DIGITS}`, "i"),
  new RegExp(
    String.raw`\b(?:visa|amex|american\s+express|master\s*card|mc|discover|debit|credit)\b[^\d$]{0,20}?[x*•#-]*\s*${CARD_DIGITS}`,
    "i",
  ),
];

const ATH_PAYMENT = /\bath\b[^\d$]{0,20}?\$?\s*([\d,]+\.\d{2})\b/gi;
const ATH_MOVIL = /\bath\s*m[oó]vil\b/i;
const FIRST_TOTAL = /(?<!sub\s?)\btotal\b/i;
const TOTAL_AMOUNT = /^[^\d]{0,8}([\d,]+\.\d{2})\b/;

function cents(value: number): number {
  return Math.round(value * 100);
}

function totalForAth(flat: string, total: number): number {
  if (total > 0) return total;
  const label = FIRST_TOTAL.exec(flat);
  if (!label) return 0;
  const amount = TOTAL_AMOUNT.exec(flat.slice(label.index + label[0].length));
  const value = Number(amount?.[1]?.replace(/,/g, "") ?? "");
  return value > 0 ? value : 0;
}

function cardDigits(text: string): string | null {
  for (const pattern of CARD_DIGIT_PATTERNS) {
    const digits = pattern.exec(text)?.[1];
    if (digits) return digits;
  }
  return null;
}

/** Works on photo OCR and on pdf.js text alike: it reads one whitespace-flattened string. */
export function detectInvoicePaymentHint(text: string, total: number): InvoicePaymentHint {
  const flat = text.replace(/\s+/g, " ");
  const totalAt = flat.search(FIRST_TOTAL);
  const tender = totalAt >= 0 ? flat.slice(totalAt) : "";
  const digits = (tender && cardDigits(tender)) || cardDigits(flat);
  if (digits) return { kind: "card", digits };
  if (ATH_MOVIL.test(flat)) return { kind: "ath" };
  const payable = totalForAth(flat, total);
  for (const match of flat.matchAll(ATH_PAYMENT)) {
    const amount = Number(match[1]!.replace(/,/g, ""));
    if (payable > 0 && cents(amount) === cents(payable)) return { kind: "ath" };
  }
  return { kind: "none" };
}

function digitRuns(row: QbAccountRow): string[] {
  const number = row.account_number?.trim() ?? "";
  return [...row.full_name.matchAll(/\d{4,}/g)].map((match) => match[0]).filter((run) => run !== number);
}

/** 4007 matches VISA x4007 but not Amex-12007; 2007 and 12007 both match Amex-12007. */
function cardDigitsMatch(run: string, digits: string): boolean {
  return run.endsWith(digits) || digits.endsWith(run.slice(-4));
}

function soleAccountLabel(rows: QbAccountRow[]): string {
  return rows.length === 1 ? qbAccountLabel(rows[0]!) : "";
}

export type InvoicePaymentSuggestion = {
  payment: InvoicePaymentDraft;
  note: string | null;
};

export function suggestInvoicePayment(input: {
  ocrText: string;
  total: number;
  accounts: QbAccountRow[];
}): InvoicePaymentSuggestion {
  const hint = detectInvoicePaymentHint(input.ocrText, input.total);
  const bank = soleAccountLabel(paymentAccountsForKind("check", input.accounts));
  switch (hint.kind) {
    case "none":
      return { payment: { kind: "bill", account: "", checkNumber: "" }, note: null };
    case "ath":
      return { payment: { kind: "check", account: bank, checkNumber: "ATH" }, note: null };
    case "card": {
      const last4 = hint.digits.slice(-4);
      const cards = paymentAccountsForKind("credit_card", input.accounts).filter((row) =>
        digitRuns(row).some((run) => cardDigitsMatch(run, hint.digits)),
      );
      if (cards.length === 1) {
        return { payment: { kind: "credit_card", account: qbAccountLabel(cards[0]!), checkNumber: "" }, note: null };
      }
      if (cards.length > 1) {
        return {
          payment: { kind: "credit_card", account: "", checkNumber: "" },
          note: `Card x${last4} matches more than one credit card account. Pick one.`,
        };
      }
      return {
        payment: { kind: "check", account: bank, checkNumber: `x${last4}` },
        note: `Card x${last4} is not a credit card account in QuickBooks. Defaulted to bank.`,
      };
    }
    default: {
      const exhaustive: never = hint;
      return exhaustive;
    }
  }
}
