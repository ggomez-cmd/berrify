import { AlertTriangle, CalendarDays, Clock, Plus, Receipt } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { KpiCard } from "../../components/ui/kpi-card";
import { SearchInput } from "../../components/ui/search-input";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatQty, formatRelative } from "../../lib/format";
import { isLowStock, reasonLabel } from "../../lib/inventory";
import {
  filterShiftsForWeek,
  formatTimeRange,
  hoursBetween,
  isManager,
  sameDay,
  weekStart,
} from "../../lib/schedule";
import { useMyEmployee } from "../employees/hooks";
import { useInventoryItems } from "../inventory/hooks";
import { useInvoices } from "../invoices/hooks";
import { useShifts } from "../schedule/hooks";
import { useStockMovements } from "../stock/hooks";
import { useWhosWorking } from "../time-clock/hooks";

type ActivityKind = "invoice" | "clock" | "stock" | "shift" | "movement";

type ActivityItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  at: string;
  by: string;
};

function activityBadgeTone(kind: ActivityKind) {
  switch (kind) {
    case "invoice":
      return "danger" as const;
    case "clock":
      return "ok" as const;
    case "stock":
      return "warn" as const;
    case "shift":
      return "info" as const;
    case "movement":
      return "neutral" as const;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function kindLabel(kind: ActivityKind): string {
  switch (kind) {
    case "invoice":
      return "Invoice";
    case "clock":
      return "Time clock";
    case "stock":
      return "Low stock";
    case "shift":
      return "Schedule";
    case "movement":
      return "Movement";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function DashboardPage() {
  const { role, org } = useAuth();
  const manager = isManager(role);
  const [search, setSearch] = useState("");
  const itemsQuery = useInventoryItems();
  const movementsQuery = useStockMovements();
  const shiftsQuery = useShifts();
  const meQuery = useMyEmployee();
  const invoicesQuery = useInvoices();
  const workingQuery = useWhosWorking();

  const items = itemsQuery.data ?? [];
  const movements = movementsQuery.data ?? [];
  const shifts = shiftsQuery.data ?? [];
  const low = items.filter(isLowStock);
  const today = new Date();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const onToday = shifts.filter((s) => s.status === "published" && sameDay(s.starts_at, today));
  const invoices = invoicesQuery.data ?? [];
  const toReview = invoices.filter((inv) => inv.status === "received" || inv.status === "extracted");
  const weekShifts = filterShiftsForWeek(
    shifts.filter((s) => s.status === "published"),
    weekStart(today),
  );
  const scheduledHours = weekShifts.reduce((sum, shift) => sum + hoursBetween(shift.starts_at, shift.ends_at), 0);
  const onClock = workingQuery.data ?? [];
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

  const activity: ActivityItem[] = [
    ...invoices.slice(0, 8).map((inv) => ({
      id: `inv-${inv.id}`,
      kind: "invoice" as const,
      title: `Invoice ${inv.invoice_number ?? inv.id.slice(0, 8)}`,
      detail: inv.suppliers?.name ?? inv.vendor_name ?? "Vendor",
      at: inv.created_at,
      by: "Capture",
    })),
    ...low.slice(0, 6).map((item) => ({
      id: `low-${item.id}`,
      kind: "stock" as const,
      title: `${item.name} is low`,
      detail: `${formatQty(item.quantity)} ${item.unit} remaining`,
      at: item.updated_at,
      by: "System",
    })),
    ...onToday.slice(0, 6).map((shift) => ({
      id: `shift-${shift.id}`,
      kind: "shift" as const,
      title: `${shift.employees?.full_name ?? "Open"} · ${shift.position}`,
      detail: formatTimeRange(shift.starts_at, shift.ends_at),
      at: shift.starts_at,
      by: "Schedule",
    })),
    ...movements.slice(0, 8).map((m) => ({
      id: `mov-${m.id}`,
      kind: "movement" as const,
      title: `${m.inventory_items?.name ?? "Item"} ${reasonLabel(m.reason).toLowerCase()}`,
      detail: `${Number(m.delta) > 0 ? "+" : ""}${formatQty(m.delta)}`,
      at: m.created_at,
      by: "Inventory",
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const q = search.trim().toLowerCase();
  const visibleActivity = q
    ? activity.filter((row) => `${row.title} ${row.detail} ${row.kind}`.toLowerCase().includes(q))
    : activity;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Welcome back, {org?.name ?? "Workspace"}
          </h1>
          <p className="mt-0.5 text-sm text-muted">{dateLabel}</p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
          <SearchInput
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 md:flex-none"
          />
          {manager ? (
            <Link to="/invoices" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto">
                <Plus className="size-4" />
                New invoice
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Low stock"
          value={`${low.length} items`}
          hint={low.length === 0 ? "All items above reorder" : "At or below reorder"}
          icon={AlertTriangle}
          tone="wine"
        />
        <KpiCard
          title="On clock"
          value={`${onClock.length} ${onClock.length === 1 ? "employee" : "employees"}`}
          hint={onClock.length === 0 ? "Nobody clocked in" : "Working or on break"}
          icon={Clock}
          tone="ok"
        />
        <KpiCard
          title="Invoices to review"
          value={`${toReview.length} invoices`}
          hint={manager ? `${invoices.length} captured` : "Staff view"}
          icon={Receipt}
          tone="warn"
        />
        <KpiCard
          title="Scheduled hours"
          value={`${scheduledHours.toFixed(0)} this week`}
          hint={`${onToday.length} published shifts today`}
          icon={CalendarDays}
          tone="sky"
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Recent activity</h2>
        </div>
        {visibleActivity.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No recent activity yet.</p>
          </Card>
        ) : (
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <Th>Type</Th>
                <Th>Description</Th>
                <Th>Date</Th>
                <Th>By</Th>
              </tr>
            </THead>
            <tbody>
              {visibleActivity.map((row) => (
                <tr key={row.id} className="hover:bg-paper/70">
                  <Td>
                    <Badge tone={activityBadgeTone(row.kind)}>{kindLabel(row.kind)}</Badge>
                  </Td>
                  <Td>
                    <div className="font-medium">{row.title}</div>
                    <div className="text-xs text-muted">{row.detail}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatRelative(row.at)}</Td>
                  <Td className="text-muted">{row.by}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{manager ? "On today" : "My next shifts"}</h2>
            <Link to="/schedule" className="text-xs font-medium text-wine hover:underline">
              Schedule
            </Link>
          </div>
          {shiftsQuery.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : manager ? (
            onToday.length === 0 ? (
              <p className="text-sm text-muted">No published shifts today.</p>
            ) : (
              <ul className="space-y-2">
                {onToday.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{s.employees?.full_name ?? "Open"}</span>
                      <span className="ml-2 text-muted">{s.position}</span>
                    </span>
                    <span className="shrink-0 text-muted">{formatTimeRange(s.starts_at, s.ends_at)}</span>
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
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-2 text-muted">
                      {formatQty(item.quantity)} / {formatQty(item.reorder_level)} {item.unit}
                    </span>
                  </span>
                  <Badge tone="warn" dot>
                    Low stock
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
