import { Link } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { formatMoney, formatQty, formatRelative } from "../../lib/format";
import { inventoryValue, isLowStock, reasonLabel } from "../../lib/inventory";
import { formatTimeRange, isManager, sameDay } from "../../lib/schedule";
import { useMyEmployee } from "../employees/hooks";
import { useInventoryItems } from "../inventory/hooks";
import { useInvoices } from "../invoices/hooks";
import { useShifts } from "../schedule/hooks";
import { useStockMovements } from "../stock/hooks";
import { useSuppliers } from "../suppliers/hooks";

export function DashboardPage() {
  const { role, org } = useAuth();
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
  const invoiceTotal = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const reviewedCount = invoices.filter((inv) => inv.status === "reviewed" || inv.status === "exported").length;
  const fillRate = items.length === 0 ? 0 : (items.length - low.length) / items.length;
  const reviewRate = invoices.length === 0 ? 0 : reviewedCount / invoices.length;
  const myUpcoming = shifts
    .filter(
      (s) =>
        s.status === "published" &&
        s.employee_id === meQuery.data?.id &&
        new Date(s.starts_at).getTime() >= startOfToday.getTime(),
    )
    .slice(0, 5);
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-navy">Hi, welcome back</h1>
            <p className="text-sm text-muted">{org?.name ?? "Workspace"}</p>
          </div>
          <p className="text-xs text-muted">{dateLabel}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <p className="text-xs font-medium text-muted">Stock fill rate</p>
            <Gauge percent={fillRate} stroke="var(--color-wine)" label={`${Math.round(fillRate * 100)}%`} />
            <p className="text-center text-xs text-muted">
              {items.length - low.length} of {items.length} items above reorder
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-muted">Invoice review</p>
            <Gauge percent={reviewRate} stroke="var(--color-navy)" label={`${Math.round(reviewRate * 100)}%`} />
            <p className="text-center text-xs text-muted">
              {reviewedCount} of {invoices.length} bills reviewed
            </p>
          </Card>
          <Card className="border-0 bg-linear-to-br from-[#c45b4a] to-wine text-white">
            <p className="text-xs font-medium text-white/80">Inventory value</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{formatMoney(value)}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-[#5eead4]" style={{ width: `${Math.round(fillRate * 100)}%` }} />
            </div>
            <div className="mt-4 flex gap-8 text-sm">
              <div>
                <p className="text-white/75">On hand</p>
                <p className="font-semibold">{items.length} items</p>
              </div>
              <div>
                <p className="text-white/75">Low stock</p>
                <p className="font-semibold">{low.length}</p>
              </div>
            </div>
          </Card>
          <Card className="border-0 bg-linear-to-br from-[#5a2438] to-navy text-white md:col-span-2">
            <p className="text-xs font-medium text-white/80">Open supplier bills</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{formatMoney(invoiceTotal)}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-[#5eead4]" style={{ width: `${Math.round(reviewRate * 100)}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-8 text-sm">
              <div>
                <p className="text-white/75">Extracted</p>
                <p className="font-semibold">{invoices.length} WhatsApp bills</p>
              </div>
              <div>
                <p className="text-white/75">Suppliers</p>
                <p className="font-semibold">{suppliers.length}</p>
              </div>
            </div>
          </Card>
          <Card>
            <p className="text-xs font-medium text-muted">Coverage today</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-navy">{onToday.length}</p>
            <p className="text-sm text-muted">published shifts</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-muted">Items</p>
            <p className="mt-2 text-2xl font-semibold text-navy">{items.length}</p>
            <p className="text-xs font-medium text-ok">{suppliers.length} suppliers</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-muted">Low stock</p>
            <p className="mt-2 text-2xl font-semibold text-navy">{low.length}</p>
            <p className="text-xs font-medium text-warn">{low.length > 0 ? "Reorder now" : "All clear"}</p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{isManager(role) ? "On today" : "My next shifts"}</h2>
              <Link to="/schedule" className="text-xs font-medium text-wine hover:underline">
                Schedule
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

          {isManager(role) ? (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Supplier bills</h2>
                <Link to="/invoices" className="text-xs font-medium text-wine hover:underline">
                  Review
                </Link>
              </div>
              {invoicesQuery.isLoading ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : invoices.length === 0 ? (
                <p className="text-sm text-muted">No captured invoices yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {invoices.slice(0, 5).map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
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
                Inventory
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

function Gauge({ percent, stroke, label }: { percent: number; stroke: string; label: string }) {
  const clamped = Math.min(1, Math.max(0, percent));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * clamped;

  return (
    <div className="grid place-items-center py-2">
      <svg width="120" height="120" viewBox="0 0 140 140" aria-hidden>
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#eee" strokeWidth="12" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="76" textAnchor="middle" fontSize="22" fontWeight="700" fill="#0b1b3a">
          {label}
        </text>
      </svg>
    </div>
  );
}
