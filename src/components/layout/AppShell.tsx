import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

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

  return (
    <div className="flex min-h-screen bg-ink text-fog">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={titleFor(pathname)} />
        <main className="flex-1 px-6 py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
