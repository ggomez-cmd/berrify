import { assertEmployerSettings, computeCheck } from "./check";
import { selectTaxSchedule } from "./data";
import { sumCents } from "./money";
import type {
  ClassCost,
  CodeAmount,
  EarningsKind,
  KindHoursAmount,
  PayrollCheck,
  PayrollLiabilities,
  PayrollRunInput,
  PayrollRunResult,
  TaxCode,
} from "./types";

const EARNINGS_KIND_ORDER: readonly EarningsKind[] = [
  "regular",
  "overtime",
  "salary",
  "tips",
  "min_wage_makeup",
  "adjustment",
];

const EMPLOYEE_SUMMARY_CODES: readonly TaxCode[] = ["DIE", "FED-ADD-MED", "FED-MED", "FED-OASDI", "SWH"];
const EMPLOYER_SUMMARY_CODES: readonly TaxCode[] = ["DIE", "FED-FUT", "FED-MED", "FED-OASDI", "FSE", "SUT"];

export function allocateLargestRemainder(totalCents: number, weights: ReadonlyArray<{ id: string; weight: number }>): Map<string, number> {
  const combined = new Map<string, number>();
  for (const row of weights) {
    combined.set(row.id, (combined.get(row.id) ?? 0) + row.weight);
  }
  const ids = [...combined.keys()].sort();
  const allocated = new Map<string, number>();
  if (ids.length === 0 || totalCents === 0) {
    for (const id of ids) allocated.set(id, 0);
    return allocated;
  }
  const weightSum = [...combined.values()].reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    for (const id of ids) allocated.set(id, 0);
    return allocated;
  }

  const remainders: Array<{ id: string; remainder: bigint }> = [];
  let used = 0;
  for (const id of ids) {
    const weight = combined.get(id) ?? 0;
    const raw = BigInt(totalCents) * BigInt(weight);
    let floor = raw / BigInt(weightSum);
    if (raw < 0n && raw % BigInt(weightSum) !== 0n) floor -= 1n;
    const remainder = raw - floor * BigInt(weightSum);
    const amount = Number(floor);
    allocated.set(id, amount);
    used += amount;
    remainders.push({ id, remainder });
  }

  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.id.localeCompare(b.id);
    return a.remainder > b.remainder ? -1 : 1;
  });
  let leftover = totalCents - used;
  for (const row of remainders) {
    if (leftover <= 0) break;
    allocated.set(row.id, (allocated.get(row.id) ?? 0) + 1);
    leftover -= 1;
  }
  return allocated;
}

function taxAmount(lines: PayrollCheck["employeeWithholdings"], code: TaxCode): number {
  return sumCents(lines.filter((line) => line.code === code).map((line) => line.amountCents));
}

function summarizeCodes(checks: PayrollCheck[], side: "employee" | "employer", codes: readonly TaxCode[]): CodeAmount[] {
  return codes
    .map((code) => ({
      code,
      amountCents: sumCents(
        checks.map((check) => taxAmount(side === "employee" ? check.employeeWithholdings : check.employerTaxes, code)),
      ),
    }))
    .filter((row) => row.code !== "FED-ADD-MED" || row.amountCents !== 0);
}

function earningsSummary(checks: PayrollCheck[]): KindHoursAmount[] {
  const byKind = new Map<EarningsKind, { hoursHundredths: number; amountCents: number }>();
  for (const kind of EARNINGS_KIND_ORDER) {
    byKind.set(kind, { hoursHundredths: 0, amountCents: 0 });
  }
  for (const check of checks) {
    for (const line of check.earnings) {
      const current = byKind.get(line.kind) ?? { hoursHundredths: 0, amountCents: 0 };
      current.hoursHundredths += line.hoursHundredths;
      current.amountCents += line.amountCents;
      byKind.set(line.kind, current);
    }
  }
  return EARNINGS_KIND_ORDER
    .map((kind) => {
      const row = byKind.get(kind) ?? { hoursHundredths: 0, amountCents: 0 };
      return { kind, ...row };
    })
    .filter((row) => row.hoursHundredths !== 0 || row.amountCents !== 0);
}

function classCosts(checks: PayrollCheck[]): ClassCost[] {
  const totals = new Map<string, { grossCents: number; employerTaxCents: number }>();
  for (const check of checks) {
    const weights = check.earnings.map((line) => ({
      id: line.classId ?? "",
      weight: line.amountCents,
    }));
    const allocation = allocateLargestRemainder(check.employerTaxCents, weights);
    const classGross = new Map<string, number>();
    for (const line of check.earnings) {
      const id = line.classId ?? "";
      classGross.set(id, (classGross.get(id) ?? 0) + line.amountCents);
    }
    const ids = new Set([...classGross.keys(), ...allocation.keys()]);
    for (const id of ids) {
      const current = totals.get(id) ?? { grossCents: 0, employerTaxCents: 0 };
      current.grossCents += classGross.get(id) ?? 0;
      current.employerTaxCents += allocation.get(id) ?? 0;
      totals.set(id, current);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classId, row]) => ({
      classId,
      grossCents: row.grossCents,
      employerTaxCents: row.employerTaxCents,
      employerCostCents: row.grossCents + row.employerTaxCents,
    }));
}

export function computePayrollLiabilities(payrollChecks: PayrollCheck[]): PayrollLiabilities {
  const eeDie = sumCents(payrollChecks.map((check) => taxAmount(check.employeeWithholdings, "DIE")));
  const erDie = sumCents(payrollChecks.map((check) => taxAmount(check.employerTaxes, "DIE")));
  const eeOasdi = sumCents(payrollChecks.map((check) => taxAmount(check.employeeWithholdings, "FED-OASDI")));
  const erOasdi = sumCents(payrollChecks.map((check) => taxAmount(check.employerTaxes, "FED-OASDI")));
  const eeMed = sumCents(payrollChecks.map((check) => taxAmount(check.employeeWithholdings, "FED-MED")));
  const erMed = sumCents(payrollChecks.map((check) => taxAmount(check.employerTaxes, "FED-MED")));
  const addMed = sumCents(payrollChecks.map((check) => taxAmount(check.employeeWithholdings, "FED-ADD-MED")));
  const futaCents = sumCents(payrollChecks.map((check) => taxAmount(check.employerTaxes, "FED-FUT")));
  const incomeTaxWithheldCents = sumCents(payrollChecks.map((check) => taxAmount(check.employeeWithholdings, "SWH")));
  const unemploymentCents = sumCents(payrollChecks.map((check) => taxAmount(check.employerTaxes, "SUT")));
  const disabilityCents = eeDie + erDie;
  const socialSecurityCents = eeOasdi + erOasdi + eeMed + erMed + addMed;
  return {
    disabilityCents,
    futaCents,
    incomeTaxWithheldCents,
    socialSecurityCents,
    unemploymentCents,
    totalCents: disabilityCents + futaCents + incomeTaxWithheldCents + socialSecurityCents + unemploymentCents,
  };
}

// Invalid inputs are dropped and reported in `errors`; totals are then a draft preview.
// Callers must not approve, pay, export, or persist YTD for a run with any errors.
export function computePayrollRun(input: PayrollRunInput): PayrollRunResult {
  const schedule = selectTaxSchedule(input.checkDate);
  assertEmployerSettings(input.settings);
  const seen = new Set<string>();
  for (const employee of input.employees) {
    if (seen.has(employee.employeeId)) {
      throw new Error(`Employee ${employee.employeeId} appears more than once in the run; combine their earnings into one entry`);
    }
    seen.add(employee.employeeId);
  }
  const checks = input.employees.map((employee) => computeCheck(employee, input.settings, input.checkDate, schedule));
  const payrollChecks = checks.filter((check) => check.payType === "payroll");
  const cashChecks = checks.filter((check) => check.payType === "cash");

  const payrollGrossCents = sumCents(payrollChecks.map((check) => check.grossCents));
  const employeeDeductionCents = sumCents(payrollChecks.map((check) => check.employeeDeductionCents));
  const netPayCents = sumCents(payrollChecks.map((check) => check.netCents));
  const employerTaxCents = sumCents(payrollChecks.map((check) => check.employerTaxCents));

  return {
    checkDate: input.checkDate,
    scheduleId: schedule.id,
    checks,
    earningsByKind: earningsSummary(checks),
    employeeWithholdingsByCode: summarizeCodes(payrollChecks, "employee", EMPLOYEE_SUMMARY_CODES),
    employerTaxesByCode: summarizeCodes(payrollChecks, "employer", EMPLOYER_SUMMARY_CODES),
    liabilities: computePayrollLiabilities(payrollChecks),
    payrollGrossCents,
    employeeDeductionCents,
    netPayCents,
    employerTaxCents,
    employerCostCents: payrollGrossCents + employerTaxCents,
    cashTotalCents: sumCents(cashChecks.map((check) => check.grossCents)),
    classCosts: classCosts(payrollChecks),
    cashClassCosts: classCosts(cashChecks),
    warnings: checks.flatMap((check) => check.warnings.map((warning) => `${check.employeeId}: ${warning}`)),
    errors: checks.flatMap((check) => check.errors.map((error) => `${check.employeeId}: ${error}`)),
  };
}
