import { Menu } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { cn } from "../../lib/cn";
import { BrandMark } from "../ui/brand-mark";
import { Sidebar } from "./Sidebar";

function titleFor(path: string): string {
  if (path.startsWith("/inventory")) return "Inventory";
  if (path.startsWith("/suppliers")) return "Suppliers";
  if (path.startsWith("/movements")) return "Stock movements";
  if (path.startsWith("/employees")) return "Employees";
  if (path.startsWith("/schedule")) return "Schedule";
  if (path.startsWith("/time-clock")) return "Time Clock";
  if (path.startsWith("/invoices")) return "Invoices";
  return "Dashboard";
}

export function AppShell() {
  const { pathname } = useLocation();
  const { org } = useAuth();
  const showPageTitle = pathname !== "/";
  const [navOpen, setNavOpen] = useState(false);
  const drawerId = useId();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  const closeNav = () => setNavOpen(false);

  return (
    <div className="flex min-h-dvh bg-paper text-ink">
      <Sidebar className="sticky top-0 hidden md:flex" />

      {navOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-navy/40 md:hidden"
          aria-label="Close menu overlay"
          onClick={closeNav}
        />
      ) : null}

      <Sidebar
        id={drawerId}
        label="Navigation"
        hidden={!navOpen}
        onNavigate={closeNav}
        onClose={closeNav}
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:hidden",
          navOpen ? "translate-x-0" : "pointer-events-none -translate-x-full",
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink hover:bg-paper"
            aria-label="Open menu"
            aria-expanded={navOpen}
            aria-controls={drawerId}
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          {showPageTitle ? (
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-ink">
                {titleFor(pathname)}
              </h1>
              <p className="truncate text-xs text-muted">{org?.name ?? "Workspace"}</p>
            </div>
          ) : (
            <BrandMark className="h-7 w-[6.5rem] text-wine" />
          )}
        </header>

        <main className="min-w-0 flex-1 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8 md:py-6">
          {showPageTitle ? (
            <div className="mb-5 hidden md:block">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{titleFor(pathname)}</h1>
              <p className="mt-0.5 text-sm text-muted">{org?.name ?? "Workspace"}</p>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
