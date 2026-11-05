import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { payStubChecks, payStubFileName } from "../../lib/payroll/reports";
import { resultFromStoredRun } from "../../lib/payroll/runs";
import { isAdmin } from "../../lib/schedule";
import type { PayrollEmployeeProfileRow } from "../../lib/types";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { usePayrollEmployeeProfiles } from "../payroll-setup/hooks";
import { usePayrollRun } from "./hooks";
import { PayStub } from "./PayStub";

export function PayStubsPage() {
  const { runId, employeeId } = useParams();
  const { org, role } = useAuth();
  const runQuery = usePayrollRun(runId);
  const employeesQuery = useEmployees();
  const profilesQuery = usePayrollEmployeeProfiles();
  const restaurantsQuery = useRestaurants();

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of employeesQuery.data ?? []) map[row.id] = row.full_name;
    return map;
  }, [employeesQuery.data]);
  const profiles = useMemo(() => {
    const map: Record<string, PayrollEmployeeProfileRow> = {};
    for (const row of profilesQuery.data ?? []) map[row.employee_id] = row;
    return map;
  }, [profilesQuery.data]);

  const run = runQuery.data;
  const restaurantName = run?.restaurant_id
    ? (restaurantsQuery.data?.find((restaurant) => restaurant.id === run.restaurant_id)?.name ?? null)
    : null;
  const fileName = run
    ? payStubFileName({
        restaurantName,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        employeeName: employeeId ? names[employeeId] : null,
      })
    : null;

  // Browsers use the page title as the default name for "Save as PDF".
  useEffect(() => {
    if (!fileName) return;
    const previous = document.title;
    document.title = fileName;
    return () => {
      document.title = previous;
    };
  }, [fileName]);

  if (!isAdmin(role)) {
    return <p className="text-sm text-muted">Pay stubs are limited to admins.</p>;
  }
  if (runQuery.isLoading) return <p className="text-sm text-muted">Loading stubs…</p>;
  if (runQuery.error) return <p className="text-sm text-danger">{runQuery.error.message}</p>;
  if (!runQuery.data) return <p className="text-sm text-muted">Run not found.</p>;

  const result = resultFromStoredRun(runQuery.data);
  const canExport = runQuery.data.status === "approved" && result.errors.length === 0;
  const checks = payStubChecks(result.checks, employeeId);

  if (!canExport) {
    return (
      <p className="text-sm text-muted">
        Pay stubs are available only after a run is approved with no errors.{" "}
        <Link className="font-medium text-wine" to={`/payroll/runs/${runQuery.data.id}`}>
          Back to run
        </Link>
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="text-sm font-medium text-wine" to={`/payroll/runs/${runQuery.data.id}`}>
          Back to run
        </Link>
        <Button onClick={() => window.print()}>{employeeId ? "Print stub" : "Print all stubs"}</Button>
      </div>
      {checks.length === 0 ? (
        <p className="text-sm text-muted">No pay stubs: cash employees are paid by the restaurant and do not get one.</p>
      ) : null}
      {checks.map((check) => {
        const profile = profiles[check.employeeId];
        return (
          <PayStub
            key={check.employeeId}
            check={check}
            employerName={org?.name ?? "Employer"}
            employeeName={names[check.employeeId] ?? check.employeeId}
            employeeNumber={profile?.employee_number ?? undefined}
            paymentMethod={paymentMethodLabel(profile)}
            workplace={restaurantName}
            periodStart={runQuery.data.period_start.slice(0, 10)}
            periodEnd={runQuery.data.period_end.slice(0, 10)}
          />
        );
      })}
    </div>
  );
}

function paymentMethodLabel(profile: PayrollEmployeeProfileRow | undefined): string {
  switch (profile?.payment_method) {
    case "ach":
      return "Depósito directo";
    case "check":
      return "Cheque";
    case "cash":
      return "Efectivo";
    default:
      return "—";
  }
}
