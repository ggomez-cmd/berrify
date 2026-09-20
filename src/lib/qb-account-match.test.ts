import { describe, expect, it } from "vitest";
import { ACCOUNTS, expensesFromLinesOrExtract, rollupExpenses, type ExtractedSku } from "./invoice-extract";
import {
  accountSelectValues,
  accountsForConnection,
  apAccountsForSelect,
  applyQbAccountNames,
  connectionIdForInvoiceAccounts,
  matchQbAccount,
  qbAccountLabel,
  resolveQbAccountRef,
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
const kaneAp = {
  connection_id: "conn-kane",
  list_id: "4",
  full_name: "Accounts Payable",
  account_number: "20000",
  account_type: "AccountsPayable",
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

  it("resolves display labels to ListID and stored FullName", () => {
    const kanePayable = {
      connection_id: "conn-kane",
      list_id: "80000026-6",
      full_name: "Sales Tax Payable",
      account_number: "266000",
      account_type: "OtherCurrentLiability",
      is_active: true,
    };
    const wine = {
      ...kaneWine,
      full_name: "Wine Purchase",
      list_id: "80000051-5",
    };
    expect(resolveQbAccountRef("266000 · Sales Tax Payable", [kanePayable, wine])).toEqual({
      listId: "80000026-6",
      fullName: "Sales Tax Payable",
    });
    expect(resolveQbAccountRef("51500 · Wine Purchase", [kanePayable, wine])).toEqual({
      listId: "80000051-5",
      fullName: "Wine Purchase",
    });
    expect(resolveQbAccountRef("266000 · Sales Tax Payable", []).fullName).toBe("Sales Tax Payable");
    expect(resolveQbAccountRef("266000 · Sales Tax Payable", []).listId).toBeNull();
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

  it("scopes expense select options to the invoice restaurant connection", () => {
    const kaneId = connectionIdForInvoiceAccounts("rest-kane", [
      { id: "conn-kane", restaurant_id: "rest-kane", is_active: true },
      { id: "conn-semilla", restaurant_id: "rest-semilla", is_active: true },
    ]);
    const semillaId = connectionIdForInvoiceAccounts("rest-semilla", [
      { id: "conn-kane", restaurant_id: "rest-kane", is_active: true },
      { id: "conn-semilla", restaurant_id: "rest-semilla", is_active: true },
    ]);
    const all = [kaneTax, kaneWine, kaneFood, kaneAp, semillaFood];
    expect(accountSelectValues(accountsForConnection(kaneId, all))).toEqual([
      "68200 · SalesTaxExpense",
      "51500 · WinePurchase",
      "50000 · Food Purchases",
      "20000 · Accounts Payable",
    ]);
    expect(accountSelectValues(accountsForConnection(semillaId, all))).toEqual(["Local Produce"]);
    expect(accountSelectValues(accountsForConnection(semillaId, all))).not.toContain("68200 · SalesTaxExpense");
  });

  it("keeps an unmatched current expense account selectable", () => {
    expect(accountSelectValues([kaneTax, kaneWine], "Sales Tax Payable")).toEqual([
      "68200 · SalesTaxExpense",
      "51500 · WinePurchase",
      "Sales Tax Payable",
    ]);
  });

  it("lists A/P-typed accounts for the footer select", () => {
    expect(apAccountsForSelect([kaneTax, kaneWine, kaneFood, kaneAp]).map(qbAccountLabel)).toEqual([
      "20000 · Accounts Payable",
    ]);
  });
});
