import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { costPerBusiness, summarizeRun } from "../../lib/payroll/reports";
import type { PayrollCheck, PayrollRunResult } from "../../lib/payroll-engine/types";
import { formatCents, formatHoursHundredths, readableIssue } from "./format";

export function IssuesPanel({
  errors,
  warnings,
  names,
  restaurantNames,
}: {
  errors: string[];
  warnings: string[];
  names: Record<string, string>;
  restaurantNames: Record<string, string>;
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="grid gap-3">
      {errors.length > 0 ? (
        <div className="rounded-xl border border-danger/25 bg-danger/10 p-3">
          <div className="mb-2">
            <Badge tone="danger">Errors</Badge>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
            {errors.map((row) => (
              <li key={row}>{readableIssue(row, names, restaurantNames)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-xl border border-warn/25 bg-warn/10 p-3">
          <div className="mb-2">
            <Badge tone="warn">Warnings</Badge>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
            {warnings.map((row) => (
              <li key={row}>{readableIssue(row, names, restaurantNames)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function RunSummaryPanel({
  result,
  restaurantNames,
}: {
  result: PayrollRunResult;
  restaurantNames?: Readonly<Record<string, string>>;
}) {
  const summary = summarizeRun(result);
  const costs = costPerBusiness(result, restaurantNames);
  return (
    <div className="grid gap-4">
      <Card>
        <h2 className="text-base font-semibold tracking-tight">Earnings</h2>
        <Table className="mt-3 min-w-0">
          <THead>
            <tr>
              <Th>Type</Th>
              <Th>Hours</Th>
              <Th>Amount</Th>
            </tr>
          </THead>
          <tbody>
            {summary.earnings.map((row) => (
              <tr key={row.kind}>
                <Td>{row.label}</Td>
                <Td>{formatHoursHundredths(row.hoursHundredths)}</Td>
                <Td>{formatCents(row.amountCents)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-base font-semibold tracking-tight">Employee withholdings</h2>
          <Table className="mt-3 min-w-0">
            <THead>
              <tr>
                <Th>Code</Th>
                <Th>Amount</Th>
              </tr>
            </THead>
            <tbody>
              {summary.employeeWithholdings.map((row) => (
                <tr key={row.code}>
                  <Td>
                    {row.code} · {row.label}
                  </Td>
                  <Td>{formatCents(row.amountCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <h2 className="text-base font-semibold tracking-tight">Employer taxes</h2>
          <Table className="mt-3 min-w-0">
            <THead>
              <tr>
                <Th>Code</Th>
                <Th>Amount</Th>
              </tr>
            </THead>
            <tbody>
              {summary.employerTaxes.map((row) => (
                <tr key={row.code}>
                  <Td>
                    {row.code} · {row.label}
                  </Td>
                  <Td>{formatCents(row.amountCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Total Payroll Liabilities to be Paid or Debited</h2>
        <Table className="mt-3 min-w-0">
          <THead>
            <tr>
              <Th>Liability</Th>
              <Th>Amount</Th>
            </tr>
          </THead>
          <tbody>
            {summary.liabilities.map((row) => (
              <tr key={row.key}>
                <Td>{row.label}</Td>
                <Td>{formatCents(row.amountCents)}</Td>
              </tr>
            ))}
            <tr>
              <Td className="font-semibold">Total</Td>
              <Td className="font-semibold">{formatCents(summary.liabilitiesTotalCents)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Gross" value={formatCents(summary.payrollGrossCents)} />
        <Kpi label="Deductions" value={formatCents(summary.employeeDeductionCents)} />
        <Kpi label="Net" value={formatCents(summary.netPayCents)} />
        <Kpi label="Employer cost" value={formatCents(summary.employerCostCents)} />
        <Kpi label="Cash workers" value={formatCents(summary.cashTotalCents)} />
      </div>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Cost per business</h2>
        <Table className="mt-3 min-w-0">
          <THead>
            <tr>
              <Th>Business</Th>
              <Th>Pay type</Th>
              <Th>Gross</Th>
              <Th>Employer taxes</Th>
              <Th>Employer cost</Th>
            </tr>
          </THead>
          <tbody>
            {costs.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-8 text-center text-muted">
                  No class costs on this run.
                </Td>
              </tr>
            ) : (
              costs.map((row) => (
                <tr key={`${row.payType}-${row.classId}`}>
                  <Td>{row.label}</Td>
                  <Td>{row.payType}</Td>
                  <Td>{formatCents(row.grossCents)}</Td>
                  <Td>{formatCents(row.employerTaxCents)}</Td>
                  <Td>{formatCents(row.employerCostCents)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
    </Card>
  );
}

export function ChecksTable({
  checks,
  names,
  numbers,
}: {
  checks: PayrollCheck[];
  names: Readonly<Record<string, string>>;
  numbers?: Readonly<Record<string, string>>;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <Th>Employee</Th>
          <Th>Type</Th>
          <Th>Hours</Th>
          <Th>Gross</Th>
          <Th>Deductions</Th>
          <Th>Net</Th>
        </tr>
      </THead>
      <tbody>
        {checks.length === 0 ? (
          <tr>
            <Td colSpan={6} className="py-10 text-center text-muted">
              No checks yet. Calculate the run to preview them.
            </Td>
          </tr>
        ) : (
          checks.map((check) => (
            <tr key={check.employeeId}>
              <Td>
                <span className="font-medium">{names[check.employeeId] ?? check.employeeId}</span>
                {numbers?.[check.employeeId] ? (
                  <span className="ml-2 text-xs text-muted">#{numbers[check.employeeId]}</span>
                ) : null}
              </Td>
              <Td>{check.payType}</Td>
              <Td>{formatHoursHundredths(check.earnings.reduce((sum, line) => sum + line.hoursHundredths, 0))}</Td>
              <Td>{formatCents(check.grossCents)}</Td>
              <Td>{formatCents(check.employeeDeductionCents)}</Td>
              <Td>{formatCents(check.netCents)}</Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

export function CheckDetail({
  check,
  name,
  number,
}: {
  check: PayrollCheck;
  name: string;
  number?: string;
}) {
  return (
    <Card>
      <h3 className="text-base font-semibold tracking-tight">
        {name}
        {number ? <span className="ml-2 text-sm font-medium text-muted">#{number}</span> : null}
      </h3>
      <p className="mt-1 text-xs font-medium text-muted">
        {check.payType} · check {check.checkDate}
      </p>
      <Table className="mt-3 min-w-0">
        <THead>
          <tr>
            <Th>Earning</Th>
            <Th>Hours</Th>
            <Th>Rate</Th>
            <Th>Amount</Th>
          </tr>
        </THead>
        <tbody>
          {check.earnings.map((line, index) => (
            <tr key={`${line.kind}-${index}`}>
              <Td>{line.kind}</Td>
              <Td>{formatHoursHundredths(line.hoursHundredths)}</Td>
              <Td>{line.rateCents == null ? "—" : formatCents(line.rateCents)}</Td>
              <Td>{formatCents(line.amountCents)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Withholdings</p>
          <ul className="space-y-1 text-sm">
            {check.employeeWithholdings.map((line) => (
              <li key={line.code}>
                {line.code} {formatCents(line.amountCents)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Employer taxes</p>
          <ul className="space-y-1 text-sm">
            {check.employerTaxes.map((line) => (
              <li key={line.code}>
                {line.code} {formatCents(line.amountCents)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-sm">
        Gross {formatCents(check.grossCents)} · Deductions {formatCents(check.employeeDeductionCents)} · Net{" "}
        {formatCents(check.netCents)}
      </p>
    </Card>
  );
}
