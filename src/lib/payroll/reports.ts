import type {
  ClassCost,
  EarningsKind,
  PayrollCheck,
  PayrollLiabilities,
  PayrollRunResult,
  TaxCode,
} from "../payroll-engine/types";

export type RunEarningsRow = {
  kind: EarningsKind;
  label: string;
  hoursHundredths: number;
  amountCents: number;
};

export type RunTaxRow = {
  code: TaxCode;
  label: string;
  amountCents: number;
};

export type LiabilityRow = {
  key: keyof Omit<PayrollLiabilities, "totalCents">;
  label: string;
  amountCents: number;
};

export type CostPerBusinessRow = {
  classId: string;
  label: string;
  payType: "payroll" | "cash";
  grossCents: number;
  employerTaxCents: number;
  employerCostCents: number;
};

export type RunSummaryReport = {
  earnings: RunEarningsRow[];
  employeeWithholdings: RunTaxRow[];
  employerTaxes: RunTaxRow[];
  liabilities: LiabilityRow[];
  liabilitiesTotalCents: number;
  payrollGrossCents: number;
  employeeDeductionCents: number;
  netPayCents: number;
  employerTaxCents: number;
  employerCostCents: number;
  cashTotalCents: number;
};

const EARNINGS_LABELS: Record<EarningsKind, string> = {
  regular: "Regular",
  overtime: "Overtime",
  salary: "Salary",
  tips: "Tips",
  min_wage_makeup: "Minimum wage makeup",
  adjustment: "Adjustment",
};

const TAX_LABELS: Record<TaxCode, string> = {
  DIE: "Disability",
  "FED-ADD-MED": "Additional Medicare",
  "FED-FUT": "FUTA",
  "FED-MED": "Medicare",
  "FED-OASDI": "Social Security",
  FSE: "FSE",
  SUT: "Unemployment",
  SWH: "Income tax",
};

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function centsToCsvAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function hoursToCsv(hundredths: number): string {
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function amountOnCheck(
  check: PayrollCheck,
  code: TaxCode,
  side: "employee" | "employer" = "employee",
): number {
  const lines = side === "employee" ? check.employeeWithholdings : check.employerTaxes;
  return lines.find((line) => line.code === code)?.amountCents ?? 0;
}

export function hoursOnCheck(check: PayrollCheck): number {
  return check.earnings.reduce((sum, line) => sum + line.hoursHundredths, 0);
}

export function amountByKind(check: PayrollCheck, kind: EarningsKind): number {
  return check.earnings.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountCents, 0);
}

export function summarizeRun(result: PayrollRunResult): RunSummaryReport {
  return {
    earnings: result.earningsByKind.map((row) => ({
      kind: row.kind,
      label: EARNINGS_LABELS[row.kind],
      hoursHundredths: row.hoursHundredths,
      amountCents: row.amountCents,
    })),
    employeeWithholdings: result.employeeWithholdingsByCode.map((row) => ({
      code: row.code,
      label: TAX_LABELS[row.code],
      amountCents: row.amountCents,
    })),
    employerTaxes: result.employerTaxesByCode.map((row) => ({
      code: row.code,
      label: TAX_LABELS[row.code],
      amountCents: row.amountCents,
    })),
    liabilities: [
      { key: "disabilityCents", label: "Disability", amountCents: result.liabilities.disabilityCents },
      { key: "futaCents", label: "FUTA", amountCents: result.liabilities.futaCents },
      { key: "incomeTaxWithheldCents", label: "Income tax", amountCents: result.liabilities.incomeTaxWithheldCents },
      { key: "socialSecurityCents", label: "Social Security", amountCents: result.liabilities.socialSecurityCents },
      { key: "unemploymentCents", label: "Unemployment", amountCents: result.liabilities.unemploymentCents },
    ],
    liabilitiesTotalCents: result.liabilities.totalCents,
    payrollGrossCents: result.payrollGrossCents,
    employeeDeductionCents: result.employeeDeductionCents,
    netPayCents: result.netPayCents,
    employerTaxCents: result.employerTaxCents,
    employerCostCents: result.employerCostCents,
    cashTotalCents: result.cashTotalCents,
  };
}

export function costPerBusiness(
  result: PayrollRunResult,
  names: Readonly<Record<string, string>> = {},
): CostPerBusinessRow[] {
  const mapClass = (row: ClassCost, payType: "payroll" | "cash"): CostPerBusinessRow => ({
    classId: row.classId,
    label: names[row.classId] ?? (row.classId ? row.classId : "Unassigned"),
    payType,
    grossCents: row.grossCents,
    employerTaxCents: row.employerTaxCents,
    employerCostCents: row.employerCostCents,
  });
  return [
    ...result.classCosts.map((row) => mapClass(row, "payroll")),
    ...result.cashClassCosts.map((row) => mapClass(row, "cash")),
  ];
}

export const REGISTER_CSV_HEADER = [
  "Employee ID",
  "Pay type",
  "Hours",
  "Regular",
  "Overtime",
  "Salary",
  "Tips",
  "Min wage makeup",
  "Adjustment",
  "Gross",
  "DIE",
  "Additional Medicare",
  "Medicare",
  "Social Security",
  "SWH",
  "Deductions",
  "Net",
  "FUTA",
  "SUT",
  "DIE employer",
  "Medicare employer",
  "Social Security employer",
  "FSE",
  "Employer taxes",
  "Employer cost",
] as const;

export function registerCsv(
  result: PayrollRunResult,
  names: Readonly<Record<string, string>> = {},
): string {
  const lines = [REGISTER_CSV_HEADER.join(",")];
  for (const check of result.checks) {
    lines.push(
      [
        csvEscape(names[check.employeeId] ?? check.employeeId),
        check.payType,
        hoursToCsv(hoursOnCheck(check)),
        centsToCsvAmount(amountByKind(check, "regular")),
        centsToCsvAmount(amountByKind(check, "overtime")),
        centsToCsvAmount(amountByKind(check, "salary")),
        centsToCsvAmount(amountByKind(check, "tips")),
        centsToCsvAmount(amountByKind(check, "min_wage_makeup")),
        centsToCsvAmount(amountByKind(check, "adjustment")),
        centsToCsvAmount(check.grossCents),
        centsToCsvAmount(amountOnCheck(check, "DIE")),
        centsToCsvAmount(amountOnCheck(check, "FED-ADD-MED")),
        centsToCsvAmount(amountOnCheck(check, "FED-MED")),
        centsToCsvAmount(amountOnCheck(check, "FED-OASDI")),
        centsToCsvAmount(amountOnCheck(check, "SWH")),
        centsToCsvAmount(check.employeeDeductionCents),
        centsToCsvAmount(check.netCents),
        centsToCsvAmount(amountOnCheck(check, "FED-FUT", "employer")),
        centsToCsvAmount(amountOnCheck(check, "SUT", "employer")),
        centsToCsvAmount(amountOnCheck(check, "DIE", "employer")),
        centsToCsvAmount(amountOnCheck(check, "FED-MED", "employer")),
        centsToCsvAmount(amountOnCheck(check, "FED-OASDI", "employer")),
        centsToCsvAmount(amountOnCheck(check, "FSE", "employer")),
        centsToCsvAmount(check.employerTaxCents),
        centsToCsvAmount(check.employerCostCents),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export const COST_PER_BUSINESS_CSV_HEADER = [
  "Business",
  "Pay type",
  "Gross",
  "Employer taxes",
  "Employer cost",
] as const;

export function costPerBusinessCsv(
  result: PayrollRunResult,
  names: Readonly<Record<string, string>> = {},
): string {
  const lines = [COST_PER_BUSINESS_CSV_HEADER.join(",")];
  for (const row of costPerBusiness(result, names)) {
    lines.push(
      [
        csvEscape(row.label),
        row.payType,
        centsToCsvAmount(row.grossCents),
        centsToCsvAmount(row.employerTaxCents),
        centsToCsvAmount(row.employerCostCents),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
