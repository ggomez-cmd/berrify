import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Receipt,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { cn } from "../../lib/cn";
import { isManager } from "../../lib/schedule";

export function Navbar() {
  const { role, user, signOut } = useAuth();
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
    <header className="flex items-center gap-2 bg-wine px-3 text-white sm:px-4">
      <div className="mr-2 flex shrink-0 items-center gap-2 py-3">
        <img src="/berry.svg" alt="" className="size-6 brightness-0 invert" />
        <p className="text-sm font-bold lowercase tracking-tight">berrify</p>
      </div>
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium text-white/75 hover:bg-wine-deep hover:text-white",
                  isActive && "bg-wine-deep text-white",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}
        {soon.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.label}
              className="flex shrink-0 cursor-not-allowed items-center gap-1.5 px-3 py-3 text-sm text-white/35"
            >
              <Icon className="size-4" />
              {item.label}
            </span>
          );
        })}
      </nav>
      <div className="ml-2 flex shrink-0 items-center gap-3 py-2">
        <span className="hidden text-xs text-white/70 lg:inline">{user?.email}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-white/80 hover:bg-wine-deep hover:text-white"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </header>
  );
}
