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
    <aside className="flex w-60 shrink-0 flex-col bg-wine px-3 py-4 text-white">
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <img src="/berry.svg" alt="" className="size-7 brightness-0 invert" />
        <div>
          <p className="text-sm font-bold lowercase leading-none tracking-tight">berrify</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/65">ERP</p>
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
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white",
                  isActive && "bg-wine-deep text-white",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}

        <p className="mb-1 mt-5 px-3 text-[10px] uppercase tracking-[0.16em] text-white/45">
          Coming soon
        </p>
        {soon.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.label}
              className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-white/40"
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
