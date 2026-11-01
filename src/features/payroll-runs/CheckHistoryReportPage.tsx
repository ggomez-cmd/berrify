import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { checkHistoryReport, type CheckHistoryEarning, type CheckHistoryTax } from "../../lib/payroll/check-history";
import { resultFromStoredRun } from "../../lib/payroll/runs";
import { isAdmin } from "../../lib/schedule";
import { useEmployees } from "../employees/hooks";
import { usePayrollEmployeeProfiles } from "../payroll-setup/hooks";
import { formatCents, formatHoursHundredths } from "./format";
import { usePayrollRun } from "./hooks";

export function CheckHistoryReportPage() {
  const { runId } = useParams();
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
    return <p className="text-sm text-muted">Payroll reports are limited to admins.</p>;
  }
  if (runQuery.isLoading) return <p className="text-sm text-muted">Loading report…</p>;
  if (runQuery.error) return <p className="text-sm text-danger">{runQuery.error.message}</p>;
  if (!runQuery.data) return <p className="text-sm text-muted">Run not found.</p>;

  const run = runQuery.data;
  const result = resultFromStoredRun(run);
  if (run.status !== "approved" || result.errors.length > 0) {
    return (
      <p className="text-sm text-muted">
        The check history report is available only after a run is approved with no errors.{" "}
        <Link className="font-medium text-wine" to={`/payroll/runs/${run.id}`}>
          Back to run
        </Link>
      </p>
    );
  }

  const report = checkHistoryReport(result);
  const header = (
    <ReportHeader
      employerName={org?.name ?? "Employer"}
      checkDate={run.check_date.slice(0, 10)}
      periodStart={run.period_start.slice(0, 10)}
      periodEnd={run.period_end.slice(0, 10)}
    />
  );
  const employees = [...report.employees].sort((a, b) =>
    (numbers[a.employeeId] ?? names[a.employeeId] ?? a.employeeId).localeCompare(
      numbers[b.employeeId] ?? names[b.employeeId] ?? b.employeeId,
      undefined,
      { numeric: true },
    ),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link className="text-sm font-medium text-wine" to={`/payroll/runs/${run.id}`}>
          Back to run
        </Link>
        <Button onClick={() => window.print()}>Print report</Button>
      </div>

      {employees.map((employee) => (
        <ReportPage key={employee.employeeId} header={header}>
          <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
            <div>
              <SectionBar>Employee salary information</SectionBar>
              <dl className="mt-2 flex gap-8 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted">Emp Id</dt>
                  <dd className="tabular-nums">{numbers[employee.employeeId] ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted">Name</dt>
                  <dd>{names[employee.employeeId] ?? employee.employeeId}</dd>
                </div>
              </dl>
              <EarningsTable rows={employee.earnings} />
              <TotalLine label="Total gross earnings" cents={employee.grossCents} />
              <TotalLine label="Total net earnings" cents={employee.netCents} />
            </div>
            <div className="grid content-start gap-4">
              <TaxTable title="Employer withholdings" rows={employee.employerTaxes} totalCents={employee.employerTaxCents} />
              <TaxTable
                title="Employee withholdings"
                rows={employee.employeeWithholdings}
                totalCents={employee.employeeDeductionCents}
              />
            </div>
          </div>
        </ReportPage>
      ))}

      <ReportPage header={header}>
        <SectionBar>Earnings summary</SectionBar>
        <EarningsTable rows={report.earnings} />
        <TotalLine label="Total earnings" cents={report.grossCents} />
        <div className="mt-6">
          <TaxTable
            title="Employee withholding summary"
            rows={report.employeeWithholdings}
            totalCents={report.employeeDeductionCents}
          />
        </div>
      </ReportPage>

      <ReportPage header={header}>
        <TaxTable title="Employer withholding summary" rows={report.employerTaxes} totalCents={report.employerTaxCents} />
        <div className="mt-6">
          <SectionBar>Total payroll liabilities to be paid or debited</SectionBar>
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {report.liabilities.map((row) => (
                <tr key={row.label}>
                  <td className="py-1">{row.label}</td>
                  <td className="py-1 text-right tabular-nums">{formatCents(row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TotalLine label="Total" cents={report.liabilitiesTotalCents} />
        </div>
        <div className="mt-6">
          <TotalLine label="Gross wages" cents={report.grossCents} />
          <TotalLine label="Total deductions" cents={report.employeeDeductionCents} />
          <TotalLine label="Net pay" cents={report.netPayCents} />
        </div>
        <div className="mt-6">
          <SectionBar>Total payroll liabilities employer cost</SectionBar>
          <TotalLine label="Total" cents={report.employerCostCents} />
        </div>
      </ReportPage>
    </div>
  );
}

function ReportHeader({
  employerName,
  checkDate,
  periodStart,
  periodEnd,
}: {
  employerName: string;
  checkDate: string;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <header className="mb-5 text-center">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{employerName}</h2>
      <p className="text-sm font-semibold text-ink">Payroll check history report</p>
      <p className="text-sm text-muted">
        Check date {checkDate} · Period {periodStart} – {periodEnd}
      </p>
    </header>
  );
}

function ReportPage({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <article className="report-page mb-8 rounded-2xl border border-line bg-white p-6 print:mb-0 print:rounded-none print:border-0 print:p-0">
      {header}
      {children}
    </article>
  );
}

function SectionBar({ children }: { children: ReactNode }) {
  return <h3 className="rounded-lg bg-paper px-3 py-1.5 text-sm font-semibold text-ink">{children}</h3>;
}

function TotalLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="mt-2 flex justify-between gap-4 text-sm font-semibold text-ink">
      <span>{label}</span>
      <span className="tabular-nums">{formatCents(cents)}</span>
    </div>
  );
}

function EarningsTable({ rows }: { rows: CheckHistoryEarning[] }) {
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-muted">
          <th className="py-1 font-medium">Earning</th>
          <th className="py-1 text-right font-medium">Hours</th>
          <th className="py-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="py-1">{row.label}</td>
            <td className="py-1 text-right tabular-nums">{formatHoursHundredths(row.hoursHundredths)}</td>
            <td className="py-1 text-right tabular-nums">{formatCents(row.amountCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TaxTable({ title, rows, totalCents }: { title: string; rows: CheckHistoryTax[]; totalCents: number }) {
  return (
    <section>
      <SectionBar>{title}</SectionBar>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Id</th>
            <th className="py-1 font-medium">Description</th>
            <th className="py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td className="py-1 pr-3">{row.code}</td>
              <td className="py-1">{row.description}</td>
              <td className="py-1 text-right tabular-nums">{formatCents(row.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TotalLine label="Total" cents={totalCents} />
    </section>
  );
}
