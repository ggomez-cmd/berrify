import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Navbar } from "./Navbar";

function titleFor(path: string): string {
  if (path.startsWith("/inventory")) return "Inventory";
  if (path.startsWith("/suppliers")) return "Suppliers";
  if (path.startsWith("/movements")) return "Stock movements";
  if (path.startsWith("/employees")) return "Employees";
  if (path.startsWith("/schedule")) return "Schedule";
  if (path.startsWith("/invoices")) return "Invoices";
  return "Dashboard";
}

export function AppShell() {
  const { pathname } = useLocation();
  const { org } = useAuth();
  const showPageTitle = pathname !== "/";

  return (
    <div className="min-h-screen bg-paper text-ink">
      <Navbar />
      <main className="px-6 py-5">
        {showPageTitle ? (
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-navy">{titleFor(pathname)}</h1>
            <p className="text-xs text-muted">{org?.name ?? "Workspace"}</p>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
