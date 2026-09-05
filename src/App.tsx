import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { EmployeesPage } from "./features/employees/EmployeesPage";
import { InventoryPage } from "./features/inventory/InventoryPage";
import { InvoicesPage } from "./features/invoices/InvoicesPage";
import { SchedulePage } from "./features/schedule/SchedulePage";
import { MovementsPage } from "./features/stock/MovementsPage";
import { SuppliersPage } from "./features/suppliers/SuppliersPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="movements" element={<MovementsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
