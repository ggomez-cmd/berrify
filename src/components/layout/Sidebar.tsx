import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock,
  LayoutDashboard,
  Lock,
  LogOut,
  Receipt,
  Tablet,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { cn } from "../../lib/cn";
import { isAdmin, isManager } from "../../lib/schedule";
import { BrandMark } from "../ui/brand-mark";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end: boolean;
};

function NavGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink/75 hover:bg-paper hover:text-ink",
                  isActive &&
                    "bg-wine/10 text-wine before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-wine",
                )
              }
            >
              <Icon className="size-4" />
              {item.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({
  className,
  onNavigate,
  onClose,
  id,
  label,
  hidden,
}: {
  className?: string;
  onNavigate?: () => void;
  onClose?: () => void;
  id?: string;
  label?: string;
  hidden?: boolean;
}) {
  const { role, user, signOut } = useAuth();
  const manager = isManager(role);
  const admin = isAdmin(role);

  const overview: NavItem[] = manager
    ? [
        { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
        { to: "/schedule", label: "Schedule", icon: CalendarDays, end: false },
        { to: "/time-clock", label: "Time Clock", icon: Clock, end: false },
        { to: "/kiosk", label: "Kiosk", icon: Tablet, end: false },
      ]
    : [
        { to: "/schedule", label: "Schedule", icon: CalendarDays, end: false },
        { to: "/time-clock", label: "Time Clock", icon: Clock, end: false },
      ];

  const operations: NavItem[] = manager
    ? [
        ...(admin ? [{ to: "/employees", label: "Employees", icon: Users, end: false }] : []),
        { to: "/inventory", label: "Inventory", icon: Boxes, end: false },
        { to: "/invoices", label: "Invoices", icon: Receipt, end: false },
        { to: "/suppliers", label: "Suppliers", icon: Truck, end: false },
        { to: "/movements", label: "Movements", icon: ClipboardList, end: false },
      ]
    : [];

  const soon = [
    { label: "Payroll", icon: Wallet },
    { label: "Analytics", icon: BarChart3 },
  ] as const;

  return (
    <aside
      id={id}
      aria-label={label}
      aria-hidden={hidden || undefined}
      className={cn(
        "flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-5",
        className,
      )}
    >
      <div className="mb-6 flex items-start justify-between gap-2 px-2">
        <BrandMark className="text-wine" />
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-paper hover:text-ink"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col">
        <NavGroup label="Overview" items={overview} onNavigate={onNavigate} />
        <NavGroup label="Operations" items={operations} onNavigate={onNavigate} />

        {manager ? (
          <div>
            <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              Coming soon
            </p>
            {soon.map((item) => {
              const Icon = item.icon;
              return (
                <span
                  key={item.label}
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted/70"
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="size-3.5" />
                </span>
              );
            })}
          </div>
        ) : null}
      </nav>

      <div className="mt-3 border-t border-line px-2 pt-3">
        <p className="mb-1 truncate px-1 text-[11px] text-muted">{user?.email}</p>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void signOut();
          }}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
