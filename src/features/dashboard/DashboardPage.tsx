import { AlertTriangle, Boxes, DollarSign, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { formatMoney, formatQty, formatRelative } from "../../lib/format";
import { inventoryValue, isLowStock, reasonLabel } from "../../lib/inventory";
import { useInventoryItems } from "../inventory/hooks";
import { useStockMovements } from "../stock/hooks";
import { useSuppliers } from "../suppliers/hooks";

export function DashboardPage() {
  const itemsQuery = useInventoryItems();
  const suppliersQuery = useSuppliers();
  const movementsQuery = useStockMovements();

  const items = itemsQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const movements = movementsQuery.data ?? [];
  const low = items.filter(isLowStock);
  const value = inventoryValue(items);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Boxes className="size-4" />} label="Items" value={String(items.length)} />
        <Kpi icon={<DollarSign className="size-4" />} label="Inventory value" value={formatMoney(value)} />
        <Kpi
          icon={<AlertTriangle className="size-4" />}
          label="Low stock"
          value={String(low.length)}
          warn={low.length > 0}
        />
        <Kpi icon={<Truck className="size-4" />} label="Suppliers" value={String(suppliers.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Low stock</h2>
            <Link to="/inventory" className="text-xs text-berry hover:underline">
              View inventory
            </Link>
          </div>
          {itemsQuery.isLoading ? (
            <p className="text-sm text-mist">Loading…</p>
          ) : low.length === 0 ? (
            <p className="text-sm text-mist">Everything is above reorder level.</p>
          ) : (
            <ul className="space-y-2">
              {low.slice(0, 8).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-2 text-mist">
                      {formatQty(item.quantity)} / {formatQty(item.reorder_level)} {item.unit}
                    </span>
                  </span>
                  <Badge tone="warn">Reorder</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent movements</h2>
            <Link to="/movements" className="text-xs text-berry hover:underline">
              View all
            </Link>
          </div>
          {movementsQuery.isLoading ? (
            <p className="text-sm text-mist">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-mist">No stock activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {movements.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{m.inventory_items?.name ?? "Item"}</span>
                    <span className="ml-2 text-mist">{reasonLabel(m.reason)}</span>
                  </span>
                  <span className="text-mist">
                    {Number(m.delta) > 0 ? "+" : ""}
                    {formatQty(m.delta)} · {formatRelative(m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  warn,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <Card className={warn ? "border-warn/30" : undefined}>
      <div className="mb-3 flex items-center justify-between text-mist">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
