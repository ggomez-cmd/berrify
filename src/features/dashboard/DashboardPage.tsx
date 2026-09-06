import { AlertTriangle, Boxes, CalendarDays, DollarSign, Receipt, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { formatMoney, formatQty, formatRelative } from "../../lib/format";
import { inventoryValue, isLowStock, reasonLabel } from "../../lib/inventory";
import { formatTimeRange, isManager, sameDay } from "../../lib/schedule";
import { useMyEmployee } from "../employees/hooks";
import { useInventoryItems } from "../inventory/hooks";
import { useShifts } from "../schedule/hooks";
import { useStockMovements } from "../stock/hooks";
import { useInvoices } from "../invoices/hooks";
import { useSuppliers } from "../suppliers/hooks";

export function DashboardPage() {
  const { role } = useAuth();
  const itemsQuery = useInventoryItems();
  const suppliersQuery = useSuppliers();
  const movementsQuery = useStockMovements();
  const shiftsQuery = useShifts();
  const meQuery = useMyEmployee();
  const invoicesQuery = useInvoices();

  const items = itemsQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const movements = movementsQuery.data ?? [];
  const shifts = shiftsQuery.data ?? [];
  const low = items.filter(isLowStock);
  const value = inventoryValue(items);
  const today = new Date();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const onToday = shifts.filter((s) => s.status === "published" && sameDay(s.starts_at, today));
  const invoices = invoicesQuery.data ?? [];
  const myUpcoming = shifts
    .filter(
      (s) =>
        s.status === "published" &&
        s.employee_id === meQuery.data?.id &&
        new Date(s.starts_at).getTime() >= startOfToday.getTime(),
    )
    .slice(0, 5);

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
            <h2 className="font-semibold">{isManager(role) ? "On today" : "My next shifts"}</h2>
            <Link to="/schedule" className="text-xs font-medium text-wine hover:underline">
              View schedule
            </Link>
          </div>
          {shiftsQuery.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : isManager(role) ? (
            onToday.length === 0 ? (
              <p className="text-sm text-muted">No published shifts today.</p>
            ) : (
              <ul className="space-y-2">
                {onToday.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{s.employees?.full_name ?? "Open"}</span>
                      <span className="ml-2 text-muted">{s.position}</span>
                    </span>
                    <span className="text-muted">{formatTimeRange(s.starts_at, s.ends_at)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : myUpcoming.length === 0 ? (
            <p className="text-sm text-muted">No upcoming published shifts.</p>
          ) : (
            <ul className="space-y-2">
              {myUpcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {new Date(s.starts_at).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="text-muted">
                    {formatTimeRange(s.starts_at, s.ends_at)} · {s.position}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <CalendarDays className="size-4 text-muted" />
              Coverage
            </h2>
          </div>
          <p className="text-3xl font-semibold tracking-tight">{onToday.length}</p>
          <p className="mt-1 text-sm text-muted">published shifts today</p>
        </Card>

        {isManager(role) ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Receipt className="size-4 text-muted" />
                Supplier bills
              </h2>
              <Link to="/invoices" className="text-xs font-medium text-wine hover:underline">
                Review invoices
              </Link>
            </div>
            {invoicesQuery.isLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted">No captured invoices yet.</p>
            ) : (
              <ul className="space-y-2">
                {invoices.slice(0, 5).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{inv.invoice_number ?? inv.id.slice(0, 8)}</span>
                      <span className="ml-2 text-muted">{inv.suppliers?.name ?? inv.vendor_name ?? "Vendor"}</span>
                    </span>
                    <span className="text-muted">{formatMoney(inv.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Low stock</h2>
            <Link to="/inventory" className="text-xs font-medium text-wine hover:underline">
              View inventory
            </Link>
          </div>
          {itemsQuery.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : low.length === 0 ? (
            <p className="text-sm text-muted">Everything is above reorder level.</p>
          ) : (
            <ul className="space-y-2">
              {low.slice(0, 8).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-2 text-muted">
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
            <Link to="/movements" className="text-xs font-medium text-wine hover:underline">
              View all
            </Link>
          </div>
          {movementsQuery.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted">No stock activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {movements.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{m.inventory_items?.name ?? "Item"}</span>
                    <span className="ml-2 text-muted">{reasonLabel(m.reason)}</span>
                  </span>
                  <span className="text-muted">
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
    <Card className={warn ? "border-warn/40" : undefined}>
      <div className="flex items-center gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            warn ? "bg-warn/15 text-warn" : "bg-wine/10 text-wine"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-navy">{value}</p>
        </div>
      </div>
    </Card>
  );
}
