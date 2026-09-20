import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InvoiceReviewAccountField } from "./InvoiceReviewAccountField";

const kaneTax = {
  connection_id: "conn-kane",
  list_id: "1",
  full_name: "SalesTaxExpense",
  account_number: "68200",
  account_type: "Expense",
  is_active: true,
};

describe("InvoiceReviewAccountField", () => {
  it("keeps a text input when the connector has no accounts", () => {
    render(<InvoiceReviewAccountField accounts={[]} value="Cost of Goods Sold" onChange={() => undefined} />);
    expect(screen.getByDisplayValue("Cost of Goods Sold").tagName).toBe("INPUT");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("includes the current unmatched account in the select", () => {
    render(
      <InvoiceReviewAccountField
        accounts={[kaneTax]}
        value="Sales Tax Payable"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("Sales Tax Payable");
    expect(screen.getByRole("option", { name: "Select account" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "68200 · SalesTaxExpense" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sales Tax Payable" })).toBeInTheDocument();
  });
});
