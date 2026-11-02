import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { resultFromStoredRun } from "../../lib/payroll/runs";
import type { PayrollCheck } from "../../lib/payroll-engine/types";
import { isAdmin } from "../../lib/schedule";
import { useEmployees } from "../employees/hooks";
import { usePayrollEmployeeProfiles } from "../payroll-setup/hooks";
import { formatCents, formatHoursHundredths } from "./format";
import { usePayrollRun } from "./hooks";

export function PayStubsPage() {
  const { runId, employeeId } = useParams();
  const { org, role } = useAuth();
  const runQuery = usePayrollRun(runId);
  const employeesQuery = useEmployees();
  const profilesQuery = usePayrollEmployeeProfiles();

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of employeesQuery.data ?? []) map[row.id] = row.full_name;
    return map;
  }, [employeesQuery.data]);
  const numbers = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of profilesQuery.data ?? []) {
      if (row.employee_number) map[row.employee_id] = row.employee_number;
    }
    return map;
  }, [profilesQuery.data]);

  if (!isAdmin(role)) {
    return <p className="text-sm text-muted">Pay stubs are limited to admins.</p>;
  }
  if (runQuery.isLoading) return <p className="text-sm text-muted">Loading stubs…</p>;
  if (runQuery.error) return <p className="text-sm text-danger">{runQuery.error.message}</p>;
  if (!runQuery.data) return <p className="text-sm text-muted">Run not found.</p>;

  const result = resultFromStoredRun(runQuery.data);
  const canExport = runQuery.data.status === "approved" && result.errors.length === 0;
  const checks = employeeId ? result.checks.filter((check) => check.employeeId === employeeId) : result.checks;

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
      {checks.map((check) => (
        <PayStub
          key={check.employeeId}
          check={check}
          employerName={org?.name ?? "Employer"}
          employeeName={names[check.employeeId] ?? check.employeeId}
          employeeNumber={numbers[check.employeeId]}
          periodStart={runQuery.data.period_start.slice(0, 10)}
          periodEnd={runQuery.data.period_end.slice(0, 10)}
        />
      ))}
    </div>
  );
}

function PayStub({
  check,
  employerName,
  employeeName,
  employeeNumber,
  periodStart,
  periodEnd,
}: {
  check: PayrollCheck;
  employerName: string;
  employeeName: string;
  employeeNumber?: string;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <article className="pay-stub mb-8 rounded-2xl border border-line bg-white p-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">Pay stub</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">{employerName}</h2>
      <p className="mt-2 text-sm text-ink">
        {employeeName}
        {employeeNumber ? ` · #${employeeNumber}` : ""}
      </p>
      <p className="text-sm text-muted">
        Period {periodStart} – {periodEnd} · Check date {check.checkDate}
      </p>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-xs font-medium uppercase tracking-wide text-muted">
            <th className="py-2">Earnings</th>
            <th className="py-2">Hours</th>
            <th className="py-2">Rate</th>
            <th className="py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {check.earnings.map((line, index) => (
            <tr key={`${line.kind}-${index}`} className="border-t border-line">
              <td className="py-2">{line.kind}</td>
              <td className="py-2">{formatHoursHundredths(line.hoursHundredths)}</td>
              <td className="py-2">{line.rateCents == null ? "—" : formatCents(line.rateCents)}</td>
              <td className="py-2">{formatCents(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-xs font-medium uppercase tracking-wide text-muted">
            <th className="py-2">Withholding</th>
            <th className="py-2">This check</th>
            <th className="py-2">YTD</th>
          </tr>
        </thead>
        <tbody>
          {check.employeeWithholdings.map((line) => (
            <tr key={line.code} className="border-t border-line">
              <td className="py-2">{line.code}</td>
              <td className="py-2">{formatCents(line.amountCents)}</td>
              <td className="py-2">{formatCents(check.closingYtd.withheldCents[line.code] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted">Gross</dt>
          <dd className="font-semibold">{formatCents(check.grossCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Deductions</dt>
          <dd className="font-semibold">{formatCents(check.employeeDeductionCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Net</dt>
          <dd className="font-semibold">{formatCents(check.netCents)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">YTD gross</dt>
          <dd className="font-semibold">{formatCents(check.closingYtd.grossCents)}</dd>
        </div>
      </dl>
    </article>
  );
}
