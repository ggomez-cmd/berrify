import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Receipt,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { cn } from "../../lib/cn";
import { isManager } from "../../lib/schedule";

export function Sidebar() {
  const { role } = useAuth();
  const manager = isManager(role);

  const links = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/schedule", label: "Schedule", icon: CalendarDays, end: false },
    ...(manager ? [{ to: "/employees", label: "Employees", icon: Users, end: false }] : []),
    { to: "/inventory", label: "Inventory", icon: Boxes, end: false },
    ...(manager ? [{ to: "/invoices", label: "Invoices", icon: Receipt, end: false }] : []),
    { to: "/suppliers", label: "Suppliers", icon: Truck, end: false },
    { to: "/movements", label: "Movements", icon: ClipboardList, end: false },
  ] as const;

  const soon = [
    { label: "Payroll", icon: Wallet },
    { label: "Analytics", icon: BarChart3 },
  ] as const;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/8 bg-ink-2/80 px-3 py-4">
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <img src="/berry.svg" alt="" className="size-7" />
        <div>
          <p className="text-sm font-bold leading-none">Berrify</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-mist">ERP</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-mist hover:bg-white/6 hover:text-fog",
                  isActive && "bg-white/8 text-fog",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}

        <p className="mb-1 mt-5 px-3 text-[10px] uppercase tracking-[0.16em] text-mist/70">
          Coming soon
        </p>
        {soon.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.label}
              className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-mist/45"
            >
              <Icon className="size-4" />
              {item.label}
            </span>
          );
        })}
      </nav>
    </aside>
  );
}
