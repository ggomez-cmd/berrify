import type { CodeAmount, EarningsKind, PayrollCheck, PayrollRunResult, TaxCode } from "../payroll-engine/types";

// The same layout as Alchavo's "Check History Register Summary and Total", so the
// two can be compared page by page during the parallel run. Payroll checks only:
// cash pay never reaches Alchavo or the tax agencies.

export type CheckHistoryEarning = {
  label: string;
  hoursHundredths: number;
  amountCents: number;
};

export type CheckHistoryTax = {
  code: TaxCode;
  description: string;
  amountCents: number;
};

export type CheckHistoryEmployee = {
  employeeId: string;
  earnings: CheckHistoryEarning[];
  grossCents: number;
  netCents: number;
  employerTaxes: CheckHistoryTax[];
  employerTaxCents: number;
  employeeWithholdings: CheckHistoryTax[];
  employeeDeductionCents: number;
};

export type CheckHistoryLiability = { label: string; amountCents: number };

export type CheckHistoryReport = {
  employees: CheckHistoryEmployee[];
  earnings: CheckHistoryEarning[];
  grossCents: number;
  employeeWithholdings: CheckHistoryTax[];
  employeeDeductionCents: number;
  employerTaxes: CheckHistoryTax[];
  employerTaxCents: number;
  liabilities: CheckHistoryLiability[];
  liabilitiesTotalCents: number;
  netPayCents: number;
  employerCostCents: number;
};

// Salary prints as Regular Time, as Alchavo does for salaried employees.
const EARNING_LABELS: Record<EarningsKind, string> = {
  regular: "Regular Time",
  salary: "Regular Time",
  overtime: "Overtime",
  min_wage_makeup: "Minimum Wage Make-up",
  tips: "Tips Pay",
  adjustment: "Adjustment",
};
const EARNING_ORDER = ["Regular Time", "Overtime", "Minimum Wage Make-up", "Tips Pay", "Adjustment"];

const TAX_NAMES: Record<TaxCode, string> = {
  DIE: "Disability",
  "FED-ADD-MED": "Additional Medicare",
  "FED-FUT": "Federal Unemployment",
  "FED-MED": "Medicare",
  "FED-OASDI": "OASDI",
  FSE: "FSE",
  SUT: "State Unemployment",
  SWH: "State Tax Withholding",
};

function earningsRows(checks: PayrollCheck[]): CheckHistoryEarning[] {
  const rows = new Map<string, CheckHistoryEarning>();
  for (const line of checks.flatMap((check) => check.earnings)) {
    const label = EARNING_LABELS[line.kind];
    const row = rows.get(label) ?? { label, hoursHundredths: 0, amountCents: 0 };
    // Tips show 0 hours, as on the Alchavo register.
    if (line.kind !== "tips") row.hoursHundredths += line.hoursHundredths;
    row.amountCents += line.amountCents;
    rows.set(label, row);
  }
  return EARNING_ORDER.flatMap((label) => {
    const row = rows.get(label);
    return row ? [row] : [];
  });
}

function taxRows(lines: CodeAmount[], side: "Employee" | "Employer"): CheckHistoryTax[] {
  return [...lines]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ code, amountCents }) => ({ code, description: `${TAX_NAMES[code]} - ${side}`, amountCents }));
}

// The summary pages always list these codes, FSE at $0.00 included; Additional
// Medicare shows only when someone was charged it.
const EMPLOYEE_CODES: readonly TaxCode[] = ["DIE", "FED-ADD-MED", "FED-MED", "FED-OASDI", "SWH"];
const EMPLOYER_CODES: readonly TaxCode[] = ["DIE", "FED-FUT", "FED-MED", "FED-OASDI", "FSE", "SUT"];

function codeTotals(lines: CodeAmount[], codes: readonly TaxCode[]): CodeAmount[] {
  return codes
    .map((code) => ({
      code,
      amountCents: lines.filter((line) => line.code === code).reduce((total, line) => total + line.amountCents, 0),
    }))
    .filter((row) => row.code !== "FED-ADD-MED" || row.amountCents !== 0);
}

// A check lists only the taxes it was charged; zero lines are left off, as on Alchavo.
function chargedOnly(lines: CodeAmount[]): CodeAmount[] {
  return lines.filter((line) => line.amountCents !== 0);
}

export function checkHistoryReport(result: PayrollRunResult): CheckHistoryReport {
  const checks = result.checks.filter((check) => check.payType === "payroll");
  const employees = checks.map((check) => ({
    employeeId: check.employeeId,
    earnings: earningsRows([check]),
    grossCents: check.grossCents,
    netCents: check.netCents,
    employerTaxes: taxRows(chargedOnly(check.employerTaxes), "Employer"),
    employerTaxCents: check.employerTaxCents,
    employeeWithholdings: taxRows(chargedOnly(check.employeeWithholdings), "Employee"),
    employeeDeductionCents: check.employeeDeductionCents,
  }));
  const { liabilities } = result;
  return {
    employees,
    earnings: earningsRows(checks),
    grossCents: result.payrollGrossCents,
    employeeWithholdings: taxRows(
      codeTotals(checks.flatMap((check) => check.employeeWithholdings), EMPLOYEE_CODES),
      "Employee",
    ),
    employeeDeductionCents: result.employeeDeductionCents,
    employerTaxes: taxRows(codeTotals(checks.flatMap((check) => check.employerTaxes), EMPLOYER_CODES), "Employer"),
    employerTaxCents: result.employerTaxCents,
    liabilities: [
      { label: "Total Disability Insurance", amountCents: liabilities.disabilityCents },
      { label: "Total Federal Unemployment Insurance", amountCents: liabilities.futaCents },
      { label: "Total Income Tax Withheld", amountCents: liabilities.incomeTaxWithheldCents },
      { label: "Total Social Security", amountCents: liabilities.socialSecurityCents },
      { label: "Total Unemployment Insurance", amountCents: liabilities.unemploymentCents },
    ],
    liabilitiesTotalCents: liabilities.totalCents,
    netPayCents: result.netPayCents,
    employerCostCents: result.employerCostCents,
  };
}
