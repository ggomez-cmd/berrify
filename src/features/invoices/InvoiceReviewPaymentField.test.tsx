import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QbAccountRow } from "../../lib/qb-account-match";
import { InvoiceReviewPaymentField } from "./InvoiceReviewPaymentField";

const accounts: QbAccountRow[] = [
  ["cc-1", "23300", "VISA x4007", "CreditCard"],
  ["cc-2", "23400", "AMEX - 02000", "CreditCard"],
  ["bank-1", "10000", "BPPR - 016374290", "Bank"],
  ["exp-1", "50000", "Food Purchases", "CostOfGoodsSold"],
].map(([list_id, account_number, full_name, account_type]) => ({
  connection_id: "conn-semilla",
  list_id: list_id!,
  full_name: full_name!,
  account_number,
  account_type,
  is_active: true,
}));

function optionNames(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

describe("InvoiceReviewPaymentField", () => {
  it("shows only Paid with for a bill", () => {
    render(
      <InvoiceReviewPaymentField
        value={{ kind: "bill", account: "", checkNumber: "" }}
        onChange={() => undefined}
        accounts={accounts}
        note={null}
      />,
    );
    expect(screen.getByLabelText("Paid with")).toHaveValue("bill");
    expect(optionNames()).toEqual(["Bill (pay later)", "Credit card", "Bank or check"]);
    expect(screen.queryByLabelText("Check NO.")).not.toBeInTheDocument();
  });

  it("offers only credit card accounts for a card payment", () => {
    render(
      <InvoiceReviewPaymentField
        value={{ kind: "credit_card", account: "23300 · VISA x4007", checkNumber: "" }}
        onChange={() => undefined}
        accounts={accounts}
        note={null}
      />,
    );
    expect(screen.getByLabelText("Credit card account")).toHaveValue("23300 · VISA x4007");
    expect(optionNames()).toEqual([
      "Bill (pay later)",
      "Credit card",
      "Bank or check",
      "Select credit card",
      "23300 · VISA x4007",
      "23400 · AMEX - 02000",
    ]);
  });

  it("shows the bank account, an editable Check NO., and the detection note for a debit card", () => {
    const onChange = vi.fn();
    render(
      <InvoiceReviewPaymentField
        value={{ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "x1837" }}
        onChange={onChange}
        accounts={accounts}
        note="Card x1837 is not a credit card account in QuickBooks. Defaulted to bank."
      />,
    );
    expect(screen.getByLabelText("Bank account")).toHaveValue("10000 · BPPR - 016374290");
    expect(screen.getByRole("option", { name: "10000 · BPPR - 016374290" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "23300 · VISA x4007" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Card x1837 is not a credit card account in QuickBooks. Defaulted to bank."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Check NO."), { target: { value: "1042" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "1042" });
  });

  it("clears the account when the reviewer switches kind", () => {
    const onChange = vi.fn();
    render(
      <InvoiceReviewPaymentField
        value={{ kind: "check", account: "10000 · BPPR - 016374290", checkNumber: "ATH" }}
        onChange={onChange}
        accounts={accounts}
        note={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Paid with"), { target: { value: "credit_card" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "credit_card", account: "", checkNumber: "ATH" });
  });
});
