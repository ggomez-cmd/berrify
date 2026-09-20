import { describe, expect, it } from "vitest";
import { ACCOUNTS, expensesFromLinesOrExtract, rollupExpenses, type ExtractedSku } from "./invoice-extract";
import {
  accountsForConnection,
  applyQbAccountNames,
  connectionIdForInvoiceAccounts,
  matchQbAccount,
  qbAccountLabel,
} from "./qb-account-match";

const kaneTax = {
  connection_id: "conn-kane",
  list_id: "1",
  full_name: "SalesTaxExpense",
  account_number: "68200",
  account_type: "Expense",
  is_active: true,
};
const kaneWine = {
  connection_id: "conn-kane",
  list_id: "2",
  full_name: "WinePurchase",
  account_number: "51500",
  account_type: "CostOfGoodsSold",
  is_active: true,
};
const kaneFood = {
  connection_id: "conn-kane",
  list_id: "3",
  full_name: "Food Purchases",
  account_number: "50000",
  account_type: "Expense",
  is_active: true,
};
const semillaFood = {
  connection_id: "conn-semilla",
  list_id: "9",
  full_name: "Local Produce",
  account_number: null,
  account_type: "Expense",
  is_active: true,
};

function sku(overrides: Partial<ExtractedSku> & Pick<ExtractedSku, "category" | "amount">): ExtractedSku {
  return {
    code: "1",
    description: "Item",
    qty_ordered: 1,
    qty_shipped: 1,
    uom: "CS",
    pounds: null,
    unit_price: overrides.amount,
    ...overrides,
  };
}

describe("QB account match", () => {
  it("formats Kane-style number · name labels", () => {
    expect(qbAccountLabel(kaneTax)).toBe("68200 · SalesTaxExpense");
    expect(qbAccountLabel({ full_name: "68200 · SalesTaxExpense", account_number: "68200" })).toBe(
      "68200 · SalesTaxExpense",
    );
  });

  it("maps tax to the tax expense account", () => {
    expect(
      matchQbAccount({
        kind: "tax",
        accounts: [kaneTax, kaneWine, kaneFood],
        fallback: ACCOUNTS.tax,
      }),
    ).toBe("68200 · SalesTaxExpense");
  });

  it("maps wine and beverage to wine purchase", () => {
    expect(
      matchQbAccount({
        kind: "beverage",
        description: "IPA",
        accounts: [kaneTax, kaneWine, kaneFood],
        fallback: ACCOUNTS.beverage,
      }),
    ).toBe("51500 · WinePurchase");
  });

  it("falls back to account_rules defaults when nothing matches", () => {
    expect(
      matchQbAccount({
        kind: "cleaning",
        accounts: [kaneTax, kaneWine, kaneFood],
        fallback: ACCOUNTS.cleaning,
      }),
    ).toBe(ACCOUNTS.cleaning);
  });

  it("never uses Kane accounts for a Semilla connection", () => {
    const connectionId = connectionIdForInvoiceAccounts("rest-semilla", [
      { id: "conn-kane", restaurant_id: "rest-kane", is_active: true },
      { id: "conn-semilla", restaurant_id: "rest-semilla", is_active: true },
    ]);
    expect(connectionId).toBe("conn-semilla");
    expect(accountsForConnection(connectionId, [kaneTax, kaneWine, kaneFood, semillaFood])).toEqual([semillaFood]);
  });

  it("rolls tax and wine through QB names and leaves unknown on fallback", () => {
    const expenses = applyQbAccountNames(
      rollupExpenses(
        [
          sku({ category: "beverage", amount: 20, description: "Wine" }),
          sku({ category: "food", amount: 40, description: "Chicken" }),
        ],
        5,
      ),
      [kaneTax, kaneWine],
    );
    expect(expenses.find((line) => line.memo === "Tax")?.account).toBe("68200 · SalesTaxExpense");
    expect(expenses.find((line) => line.memo === "Liquor" || line.memo === "Beer")?.account).toBe(
      "51500 · WinePurchase",
    );
    expect(expenses.find((line) => line.account === ACCOUNTS.food || line.memo === "")?.account).toBe(ACCOUNTS.food);
  });

  it("keeps extract fallbacks when the QB list is empty", () => {
    const expenses = applyQbAccountNames(
      expensesFromLinesOrExtract([sku({ category: "food", amount: 10 })], 0, { total: 0, expenses: [] }),
      [],
    );
    expect(expenses).toEqual([{ account: ACCOUNTS.food, amount: 10, memo: "" }]);
  });
});
