import type { InventoryItem, MovementReason } from "./types";

export function isLowStock(item: Pick<InventoryItem, "quantity" | "reorder_level">): boolean {
  return Number(item.quantity) <= Number(item.reorder_level);
}

export function inventoryValue(
  items: Array<Pick<InventoryItem, "quantity" | "unit_cost">>,
): number {
  return items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_cost),
    0,
  );
}

export function applyMovement(quantity: number, delta: number): number {
  return Number(quantity) + Number(delta);
}

export function deltaForReason(reason: MovementReason, amount: number): number {
  switch (reason) {
    case "purchase":
      return Math.abs(amount);
    case "usage":
    case "waste":
      return -Math.abs(amount);
    case "adjustment":
      return amount;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function reasonLabel(reason: MovementReason): string {
  switch (reason) {
    case "purchase":
      return "Purchase";
    case "usage":
      return "Usage";
    case "adjustment":
      return "Adjustment";
    case "waste":
      return "Waste";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export type ItemFilters = {
  search: string;
  category: string;
  lowStockOnly: boolean;
};

export function filterItems<T extends Pick<InventoryItem, "name" | "sku" | "category" | "quantity" | "reorder_level">>(
  items: T[],
  filters: ItemFilters,
): T[] {
  const q = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.lowStockOnly && !isLowStock(item)) return false;
    if (filters.category && (item.category ?? "") !== filters.category) return false;
    if (!q) return true;
    const haystack = `${item.name} ${item.sku ?? ""} ${item.category ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}
