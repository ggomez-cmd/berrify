import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../payroll-engine";
import {
  FIXTURE_A_CHECK_DATE,
  FIXTURE_A_SETTINGS,
  FIXTURE_A_TOTALS,
  fixtureAEmployees,
} from "../payroll-engine/fixtures/fixture-a";
import { emptyYtd } from "../payroll-engine/fixtures/helpers";
import { costPerBusinessCsv, neutralizeCsvFormula, registerCsv, summarizeRun } from "./reports";
import { ytdFromHistory } from "./runs";

function fixtureARun() {
  return computePayrollRun({
    checkDate: FIXTURE_A_CHECK_DATE,
    settings: FIXTURE_A_SETTINGS,
    employees: fixtureAEmployees(),
  });
}

describe("Alchavo 2026-10-23 run reports", () => {
  it("matches fixture A hours, earnings, withholdings, net, liabilities, and employer cost", () => {
    const run = fixtureARun();
    const summary = summarizeRun(run);
    const hours = summary.earnings.reduce((sum, row) => sum + row.hoursHundredths, 0);
    const regular = summary.earnings
      .filter((row) => row.kind === "regular" || row.kind === "salary")
      .reduce((sum, row) => sum + row.amountCents, 0);
    const tips = summary.earnings.find((row) => row.kind === "tips")?.amountCents ?? 0;

    expect(hours).toBe(86_298);
    expect(regular).toBe(1_411_302);
    expect(tips).toBe(320_359);
    expect(summary.payrollGrossCents).toBe(1_731_661);
    expect(summary.employeeDeductionCents).toBe(289_053);
    expect(summary.netPayCents).toBe(1_442_608);
    expect(summary.employerTaxCents).toBe(241_566);
    expect(summary.liabilitiesTotalCents).toBe(530_619);
    expect(summary.employerCostCents).toBe(1_973_227);
    expect(summary.cashTotalCents).toBe(0);
    expect(hours).toBe(FIXTURE_A_TOTALS.hoursHundredths);
    expect(regular).toBe(FIXTURE_A_TOTALS.regularAndSalaryCents);
    expect(tips).toBe(FIXTURE_A_TOTALS.tipsCents);
    expect(summary.payrollGrossCents).toBe(FIXTURE_A_TOTALS.grossCents);
    expect(summary.employeeDeductionCents).toBe(FIXTURE_A_TOTALS.employeeWithholdingsCents);
    expect(summary.netPayCents).toBe(FIXTURE_A_TOTALS.netCents);
    expect(summary.employerTaxCents).toBe(FIXTURE_A_TOTALS.employerTaxesCents);
    expect(summary.liabilitiesTotalCents).toBe(FIXTURE_A_TOTALS.liabilitiesCents);
    expect(summary.employerCostCents).toBe(FIXTURE_A_TOTALS.employerCostCents);
    expect(summary.liabilities.map((row) => row.label)).toEqual([
      "Disability",
      "FUTA",
      "Income tax",
      "Social Security",
      "Unemployment",
    ]);
  });

  it("zeros SUT, FUT, and DIE when opening YTD is already at the wage base", () => {
    const ytd = ytdFromHistory(
      [
        {
          employeeId: "shared",
          taxYear: 2026,
          grossCents: 900_000,
          taxes: [
            { taxCode: "SUT", taxableCents: 700_000, withheldCents: 0, employerCents: 0 },
            { taxCode: "FED-FUT", taxableCents: 700_000, withheldCents: 0, employerCents: 0 },
            { taxCode: "DIE", taxableCents: 900_000, withheldCents: 0, employerCents: 0 },
          ],
        },
      ],
      [],
      [],
      2026,
    ).get("shared");
    const run = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees(ytd ?? emptyYtd({ SUT: 700_000, "FED-FUT": 700_000, DIE: 900_000 })),
    });
    for (const check of run.checks) {
      expect(check.employerTaxes.find((line) => line.code === "SUT")?.amountCents ?? 0).toBe(0);
      expect(check.employerTaxes.find((line) => line.code === "FED-FUT")?.amountCents ?? 0).toBe(0);
      expect(check.employeeWithholdings.find((line) => line.code === "DIE")?.amountCents ?? 0).toBe(0);
      expect(check.employerTaxes.find((line) => line.code === "DIE")?.amountCents ?? 0).toBe(0);
    }
  });

  it("writes a register and cost-per-business CSV in cents", () => {
    const run = fixtureARun();
    const register = registerCsv(run);
    expect(register.startsWith("Employee ID,Pay type,Hours,")).toBe(true);
    expect(register).toContain("A01,payroll,68.16,");
    const cost = costPerBusinessCsv(run, { "": "Unassigned" });
    expect(cost.startsWith("Business,Pay type,Gross,")).toBe(true);
  });

  it("neutralizes CSV formula injection in text cells and quotes names", () => {
    expect(neutralizeCsvFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeCsvFormula(" +SUM(A1)")).toBe("' +SUM(A1)");
    expect(neutralizeCsvFormula("@x")).toBe("'@x");
    const run = fixtureARun();
    const first = run.checks[0];
    if (!first) throw new Error("missing check");
    const poisoned = {
      ...run,
      checks: [
        { ...first, employeeId: "=1+1" },
        { ...first, employeeId: " +SUM(A1)" },
        { ...first, employeeId: "@x" },
        { ...first, employeeId: 'Garcia, "Ana"' },
      ],
    };
    const csv = registerCsv(poisoned, {
      "=1+1": "=1+1",
      " +SUM(A1)": " +SUM(A1)",
      "@x": "@x",
      'Garcia, "Ana"': 'Garcia, "Ana"',
    });
    expect(csv).toContain("'=1+1,payroll,");
    expect(csv).toContain("' +SUM(A1),payroll,");
    expect(csv).toContain("'@x,payroll,");
    expect(csv).toContain('"Garcia, ""Ana""",payroll,');
    expect(csv).toMatch(/payroll,\d+\.\d{2},/);
  });
});
