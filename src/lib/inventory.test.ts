import { describe, expect, it } from "vitest";
import {
  applyMovement,
  deltaForReason,
  filterItems,
  inventoryValue,
  isLowStock,
} from "./inventory";

describe("isLowStock", () => {
  it("is true when quantity is at or below reorder level", () => {
    expect(isLowStock({ quantity: 10, reorder_level: 10 })).toBe(true);
    expect(isLowStock({ quantity: 4, reorder_level: 8 })).toBe(true);
  });

  it("is false when quantity is above reorder level", () => {
    expect(isLowStock({ quantity: 11, reorder_level: 10 })).toBe(false);
  });
});

describe("inventoryValue", () => {
  it("sums quantity times unit cost", () => {
    expect(
      inventoryValue([
        { quantity: 10, unit_cost: 2.5 },
        { quantity: 4, unit_cost: 8 },
      ]),
    ).toBe(57);
  });

  it("returns 0 for an empty list", () => {
    expect(inventoryValue([])).toBe(0);
  });
});

describe("applyMovement", () => {
  it("adds a purchase and subtracts usage", () => {
    expect(applyMovement(10, 5)).toBe(15);
    expect(applyMovement(10, -3)).toBe(7);
  });
});

describe("deltaForReason", () => {
  it("maps reasons to signed deltas", () => {
    expect(deltaForReason("purchase", -8)).toBe(8);
    expect(deltaForReason("usage", 3)).toBe(-3);
    expect(deltaForReason("waste", 1.5)).toBe(-1.5);
    expect(deltaForReason("adjustment", -2)).toBe(-2);
  });
});

describe("filterItems", () => {
  const items = [
    { name: "Roma tomatoes", sku: "PR-001", category: "Produce", quantity: 12, reorder_level: 20 },
    { name: "Espresso beans", sku: "BV-010", category: "Beverages", quantity: 18, reorder_level: 10 },
  ];

  it("filters by search and low-stock flag", () => {
    expect(filterItems(items, { search: "roma", category: "", lowStockOnly: false })).toHaveLength(1);
    expect(filterItems(items, { search: "", category: "Beverages", lowStockOnly: false })).toHaveLength(1);
    expect(filterItems(items, { search: "", category: "", lowStockOnly: true })).toHaveLength(1);
  });
});
