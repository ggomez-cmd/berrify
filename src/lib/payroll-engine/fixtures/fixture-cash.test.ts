import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../run";
import {
  FIXTURE_CASH_CHECK_DATE,
  FIXTURE_CASH_SETTINGS,
  FIXTURE_CASH_TOTAL_CENTS,
  fixtureCashEmployees,
} from "./fixture-cash";

describe("cash employees", () => {
  const run = computePayrollRun({
    checkDate: FIXTURE_CASH_CHECK_DATE,
    settings: FIXTURE_CASH_SETTINGS,
    employees: fixtureCashEmployees(),
  });

  it("pays C01–C05 with no taxes and no min-wage make-up", () => {
    expect(run.checks.map((check) => check.grossCents)).toEqual([37162, 41899, 9306, 41952, 4976]);
    expect(run.checks.every((check) => check.employeeWithholdings.length === 0)).toBe(true);
    expect(run.checks.every((check) => check.employerTaxes.length === 0)).toBe(true);
    expect(run.checks.every((check) => check.earnings.every((line) => line.kind !== "min_wage_makeup"))).toBe(true);
    expect(run.cashTotalCents).toBe(FIXTURE_CASH_TOTAL_CENTS);
    expect(run.payrollGrossCents).toBe(0);
    expect(run.netPayCents).toBe(0);
    expect(run.employerTaxCents).toBe(0);
    expect(run.liabilities.totalCents).toBe(0);
  });
});
