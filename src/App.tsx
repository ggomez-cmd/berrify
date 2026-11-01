import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { EmployeesPage } from "./features/employees/EmployeesPage";
import { InventoryPage } from "./features/inventory/InventoryPage";
import { EmptyBottlesPage } from "./features/empty-bottles/EmptyBottlesPage";
import { InvoicesPage } from "./features/invoices/InvoicesPage";
import { PrivacyPage } from "./features/legal/PrivacyPage";
import { TermsPage } from "./features/legal/TermsPage";
import { QuickbooksPage } from "./features/quickbooks/QuickbooksPage";
import { KioskPage } from "./features/kiosk/KioskPage";
import { SchedulePage } from "./features/schedule/SchedulePage";
import { MovementsPage } from "./features/stock/MovementsPage";
import { SuppliersPage } from "./features/suppliers/SuppliersPage";
import { ReviewShiftsPage } from "./features/time-clock/ReviewShiftsPage";
import { TimeClockPage } from "./features/time-clock/TimeClockPage";
import { PayrollPage } from "./features/payroll/PayrollPage";
import { PayrollSetupPage } from "./features/payroll-setup/PayrollSetupPage";
import { PayStubsPage } from "./features/payroll-runs/PayStubsPage";
import { PayrollRunDetailPage } from "./features/payroll-runs/PayrollRunDetailPage";
import { PayrollRunEditorPage } from "./features/payroll-runs/PayrollRunEditorPage";
import { PayrollRunsPage } from "./features/payroll-runs/PayrollRunsPage";

function routerBasename(): string | undefined {
  const base = import.meta.env.BASE_URL;
  if (!base || base === "/") return undefined;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={routerBasename()}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="kiosk" element={<KioskPage />} />
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="time-clock" element={<TimeClockPage />} />
              <Route path="time-clock/shifts" element={<ReviewShiftsPage />} />
              <Route path="payroll" element={<PayrollPage />} />
              <Route path="payroll/setup" element={<PayrollSetupPage />} />
              <Route path="payroll/runs" element={<PayrollRunsPage />} />
              <Route path="payroll/runs/new" element={<PayrollRunEditorPage />} />
              <Route path="payroll/runs/:runId/edit" element={<PayrollRunEditRoute />} />
              <Route path="payroll/runs/:runId/stubs/:employeeId" element={<PayStubsPage />} />
              <Route path="payroll/runs/:runId/stubs" element={<PayStubsPage />} />
              <Route path="payroll/runs/:runId" element={<PayrollRunDetailRoute />} />
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="quickbooks" element={<QuickbooksPage />} />
              <Route path="empty-bottles" element={<EmptyBottlesPage />} />
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

function PayrollRunDetailRoute() {
  const { runId } = useParams();
  if (!runId) return <Navigate to="/payroll/runs" replace />;
  return <PayrollRunDetailPage runId={runId} />;
}

function PayrollRunEditRoute() {
  const { runId } = useParams();
  if (!runId) return <Navigate to="/payroll/runs/new" replace />;
  return <PayrollRunEditorPage runId={runId} />;
}
