import { Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { ITEM_CATEGORIES } from "../../lib/constants";
import { formatMoney, formatQty } from "../../lib/format";
import { filterItems, isLowStock } from "../../lib/inventory";
import type { InventoryItem, InventoryItemWithSupplier } from "../../lib/types";
import { AdjustStockDialog } from "./AdjustStockDialog";
import { useDeleteItem, useInventoryItems } from "./hooks";
import { ItemDialog } from "./ItemDialog";

export function InventoryPage() {
  const { data: items = [], isLoading, error } = useInventoryItems();
  const remove = useDeleteItem();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);

  const filtered = useMemo(
    () => filterItems(items, { search, category, lowStockOnly }),
    [items, search, category, lowStockOnly],
  );

  const openCreate = () => {
    setEditing(null);
    setItemOpen(true);
  };

  const openEdit = (item: InventoryItemWithSupplier) => {
    setEditing(item);
    setItemOpen(true);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search name, SKU, category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-40">
          <option value="">All categories</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Button
          variant={lowStockOnly ? "primary" : "ghost"}
          onClick={() => setLowStockOnly((v) => !v)}
        >
          <SlidersHorizontal className="size-4" />
          Low stock
        </Button>
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add item
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading inventory…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Category</Th>
              <Th>On hand</Th>
              <Th>Reorder</Th>
              <Th>Unit cost</Th>
              <Th>Supplier</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <Td colSpan={8} className="py-10 text-center text-muted">
                  No items match.
                </Td>
              </tr>
            ) : (
              filtered.map((item) => {
                const low = isLowStock(item);
                return (
                  <tr key={item.id} className="hover:bg-paper">
                    <Td>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted">{item.sku ?? "—"}</div>
                    </Td>
                    <Td>{item.category ?? "—"}</Td>
                    <Td>
                      {formatQty(item.quantity)} {item.unit}
                    </Td>
                    <Td>{formatQty(item.reorder_level)}</Td>
                    <Td>{formatMoney(item.unit_cost)}</Td>
                    <Td>{item.suppliers?.name ?? "—"}</Td>
                    <Td>
                      <Badge tone={low ? "warn" : "ok"}>{low ? "Low stock" : "OK"}</Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button variant="subtle" onClick={() => setAdjusting(item)}>
                          Adjust
                        </Button>
                        <Button variant="subtle" onClick={() => openEdit(item)}>
                          Edit
                        </Button>
                        <Button
                          variant="subtle"
                          onClick={() => {
                            if (window.confirm(`Delete ${item.name}?`)) {
                              void remove.mutateAsync(item.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      ) : null}

      <ItemDialog open={itemOpen} onOpenChange={setItemOpen} item={editing} />
      <AdjustStockDialog
        open={Boolean(adjusting)}
        onOpenChange={(next) => {
          if (!next) setAdjusting(null);
        }}
        item={adjusting}
      />
    </div>
  );
}
