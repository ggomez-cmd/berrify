import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
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

  return (
    <div className="flex min-h-screen bg-paper text-ink">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-6">
        {showPageTitle ? (
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{titleFor(pathname)}</h1>
            <p className="mt-0.5 text-sm text-muted">{org?.name ?? "Workspace"}</p>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
