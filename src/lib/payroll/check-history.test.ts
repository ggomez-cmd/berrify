import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../payroll-engine";
import { FIXTURE_A_CHECK_DATE, FIXTURE_A_SETTINGS, fixtureAEmployees } from "../payroll-engine/fixtures/fixture-a";
import { checkHistoryReport } from "./check-history";

function report(employees = fixtureAEmployees()) {
  return checkHistoryReport(
    computePayrollRun({ checkDate: FIXTURE_A_CHECK_DATE, settings: FIXTURE_A_SETTINGS, employees }),
  );
}

const lines = (rows: { code: string; description: string; amountCents: number }[]) =>
  rows.map((row) => `${row.code} ${row.description} ${row.amountCents}`);

describe("check history report", () => {
  it("matches the summary pages of Alchavo's 2026-10-23 register", () => {
    const r = report();
    expect(r.employees).toHaveLength(13);
    expect(r.earnings).toEqual([
      { label: "Regular Time", hoursHundredths: 86_298, amountCents: 1_411_302 },
      { label: "Tips Pay", hoursHundredths: 0, amountCents: 320_359 },
    ]);
    expect(r.grossCents).toBe(1_731_661);
    expect(lines(r.employeeWithholdings)).toEqual([
      "DIE Disability - Employee 5194",
      "FED-MED Medicare - Employee 25110",
      "FED-OASDI OASDI - Employee 107363",
      "SWH State Tax Withholding - Employee 151386",
    ]);
    expect(r.employeeDeductionCents).toBe(289_053);
    expect(lines(r.employerTaxes)).toEqual([
      "DIE Disability - Employer 5194",
      "FED-FUT Federal Unemployment - Employer 10390",
      "FED-MED Medicare - Employer 25110",
      "FED-OASDI OASDI - Employer 107363",
      "FSE FSE - Employer 0",
      "SUT State Unemployment - Employer 93509",
    ]);
    expect(r.employerTaxCents).toBe(241_566);
    expect(r.liabilities.map((row) => row.amountCents)).toEqual([10_388, 10_390, 151_386, 264_946, 93_509]);
    expect(r.liabilitiesTotalCents).toBe(530_619);
    expect(r.netPayCents).toBe(1_442_608);
    expect(r.employerCostCents).toBe(1_973_227);
  });

  it("shows a salaried check as 80 hours of Regular Time and leaves zero taxes off the check", () => {
    const salaried = report().employees.find((row) => row.grossCents === 369_230);
    expect(salaried?.earnings).toEqual([{ label: "Regular Time", hoursHundredths: 8000, amountCents: 369_230 }]);
    const noSwh = report().employees.find((row) => row.grossCents === 71_962);
    expect(noSwh?.employeeWithholdings.map((row) => row.code)).toEqual(["DIE", "FED-MED", "FED-OASDI"]);
    expect(noSwh?.employerTaxes.map((row) => row.code)).toEqual(["DIE", "FED-FUT", "FED-MED", "FED-OASDI", "SUT"]);
  });

  it("leaves cash employees off the register", () => {
    const employees = fixtureAEmployees();
    employees[0] = { ...employees[0]!, payType: "cash" };
    const r = report(employees);
    expect(r.employees).toHaveLength(12);
    expect(r.employees.some((row) => row.employeeId === employees[0]!.employeeId)).toBe(false);
    expect(r.grossCents).toBe(r.employees.reduce((sum, row) => sum + row.grossCents, 0));
  });
});
