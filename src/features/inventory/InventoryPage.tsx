import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { PageTabs } from "../../components/ui/page-tabs";
import { SearchInput } from "../../components/ui/search-input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { ITEM_CATEGORIES } from "../../lib/constants";
import { formatMoney, formatQty } from "../../lib/format";
import { filterItems, stockStatus, type StockStatus } from "../../lib/inventory";
import { isManager } from "../../lib/schedule";
import type { InventoryItem, InventoryItemWithSupplier } from "../../lib/types";
import { AdjustStockDialog } from "./AdjustStockDialog";
import { useDeleteItem, useInventoryItems } from "./hooks";
import { ItemDialog } from "./ItemDialog";

type StockTab = "all" | "low";

function statusBadge(status: StockStatus) {
  switch (status) {
    case "ok":
      return (
        <Badge tone="info" dot>
          In stock
        </Badge>
      );
    case "low":
      return (
        <Badge tone="warn" dot>
          Low stock
        </Badge>
      );
    case "out":
      return (
        <Badge tone="danger" dot>
          Out of stock
        </Badge>
      );
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function InventoryPage() {
  const { role } = useAuth();
  const manager = isManager(role);
  const { data: items = [], isLoading, error } = useInventoryItems();
  const remove = useDeleteItem();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [tab, setTab] = useState<StockTab>("all");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);

  const filtered = useMemo(
    () => filterItems(items, { search, category, lowStockOnly: tab === "low" }),
    [items, search, category, tab],
  );

  if (!manager) {
    return <Navigate to="/schedule" replace />;
  }

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
      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <SearchInput
          placeholder="Search inventory…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 md:flex-none"
        />
        <div className="w-full shrink-0 sm:w-40">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        {manager ? (
          <div className="ml-auto w-full sm:w-auto">
            <Button className="w-full sm:w-auto" onClick={openCreate}>
              <Plus className="size-4" />
              Add item
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <PageTabs
          items={[
            { id: "all", label: "All items" },
            { id: "low", label: "Low stock" },
          ]}
          value={tab}
          onChange={setTab}
        />
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
              {manager ? <Th>Unit cost</Th> : null}
              <Th>Supplier</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <Td colSpan={manager ? 8 : 7} className="py-10 text-center text-muted">
                  No items match.
                </Td>
              </tr>
            ) : (
              filtered.map((item) => {
                const status = stockStatus(item);
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
                    {manager ? <Td>{formatMoney(item.unit_cost ?? 0)}</Td> : null}
                    <Td>{item.suppliers?.name ?? "—"}</Td>
                    <Td>{statusBadge(status)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button variant="subtle" onClick={() => setAdjusting(item)}>
                          Adjust
                        </Button>
                        {manager ? (
                          <>
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
                          </>
                        ) : null}
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
