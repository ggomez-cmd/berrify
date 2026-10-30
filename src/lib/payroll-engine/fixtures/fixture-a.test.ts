import { describe, expect, it } from "vitest";
import { computeCheck } from "../check";
import { computePayrollRun } from "../run";
import { amountOn, emptyYtd, explicitEmployee } from "./helpers";
import {
  FIXTURE_A_CHECK_DATE,
  FIXTURE_A_ROWS,
  FIXTURE_A_SETTINGS,
  FIXTURE_A_TOTALS,
  FIXTURE_A_YTD_REDUCTION,
  fixtureAEmployees,
} from "./fixture-a";

describe("Fixture A annualized 2026-10-23", () => {
  const run = computePayrollRun({
    checkDate: FIXTURE_A_CHECK_DATE,
    settings: FIXTURE_A_SETTINGS,
    employees: fixtureAEmployees(),
  });

  it.each(FIXTURE_A_ROWS)("$employeeId matches reference check", (row) => {
    const check = run.checks.find((item) => item.employeeId === row.employeeId);
    expect(check).toBeDefined();
    if (!check) return;
    expect(check.grossCents).toBe(row.grossCents);
    expect(amountOn(check, "DIE")).toBe(row.dieCents);
    expect(amountOn(check, "FED-MED")).toBe(row.medCents);
    expect(amountOn(check, "FED-OASDI")).toBe(row.oasdiCents);
    expect(amountOn(check, "SWH")).toBe(row.swhCents);
    expect(check.netCents).toBe(row.netCents);
    expect(amountOn(check, "FED-FUT", "employer")).toBe(row.futCents);
    expect(amountOn(check, "SUT", "employer")).toBe(row.sutCents);
    expect(amountOn(check, "DIE", "employer")).toBe(row.dieCents);
    expect(amountOn(check, "FED-MED", "employer")).toBe(row.medCents);
    expect(amountOn(check, "FED-OASDI", "employer")).toBe(row.oasdiCents);
    expect(amountOn(check, "FSE", "employer")).toBe(0);
  });

  it("matches run totals", () => {
    const hours = run.earningsByKind.reduce((sum, row) => sum + row.hoursHundredths, 0);
    const regularAndSalary = run.earningsByKind
      .filter((row) => row.kind === "regular" || row.kind === "salary")
      .reduce((sum, row) => sum + row.amountCents, 0);
    const tips = run.earningsByKind.find((row) => row.kind === "tips")?.amountCents ?? 0;
    expect(hours).toBe(FIXTURE_A_TOTALS.hoursHundredths);
    expect(regularAndSalary).toBe(FIXTURE_A_TOTALS.regularAndSalaryCents);
    expect(tips).toBe(FIXTURE_A_TOTALS.tipsCents);
    expect(run.payrollGrossCents).toBe(FIXTURE_A_TOTALS.grossCents);
    expect(run.employeeDeductionCents).toBe(FIXTURE_A_TOTALS.employeeWithholdingsCents);
    expect(run.netPayCents).toBe(FIXTURE_A_TOTALS.netCents);
    expect(run.employerTaxCents).toBe(FIXTURE_A_TOTALS.employerTaxesCents);
    expect(run.liabilities.totalCents).toBe(FIXTURE_A_TOTALS.liabilitiesCents);
    expect(run.employerCostCents).toBe(FIXTURE_A_TOTALS.employerCostCents);
    expect(run.cashTotalCents).toBe(0);
  });
});

describe("Fixture A-YTD wage bases", () => {
  it("zeros SUT, FUT, and DIE when opening YTD is already at the wage base", () => {
    const run = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees(emptyYtd({ SUT: 700_000, "FED-FUT": 700_000, DIE: 900_000 })),
    });
    for (const check of run.checks) {
      expect(amountOn(check, "SUT", "employer")).toBe(0);
      expect(amountOn(check, "FED-FUT", "employer")).toBe(0);
      expect(amountOn(check, "DIE")).toBe(0);
      expect(amountOn(check, "DIE", "employer")).toBe(0);
    }
    const baseline = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees(),
    });
    expect(baseline.employerTaxesByCode.find((row) => row.code === "SUT")?.amountCents).toBe(
      FIXTURE_A_YTD_REDUCTION.sutCents,
    );
    expect(baseline.employerTaxesByCode.find((row) => row.code === "FED-FUT")?.amountCents).toBe(
      FIXTURE_A_YTD_REDUCTION.futCents,
    );
    expect(baseline.employerTaxesByCode.find((row) => row.code === "DIE")?.amountCents).toBe(
      FIXTURE_A_YTD_REDUCTION.employerDieCents,
    );
    expect(baseline.employeeWithholdingsByCode.find((row) => row.code === "DIE")?.amountCents).toBe(
      FIXTURE_A_YTD_REDUCTION.employeeDieCents,
    );
  });

  it("A01 opening SUT/FUTA YTD 6500 → taxable 500 → SUT 27.00, FUT 3.00", () => {
    const row = FIXTURE_A_ROWS[0];
    if (!row) throw new Error("missing A01");
    const check = computeCheck(
      explicitEmployee({
        employeeId: "A01",
        kind: "hourly",
        amountCents: row.regularOrSalaryCents,
        hoursHundredths: row.hoursHundredths,
        tipsCents: row.tipsCents,
        exemptionCents: 0,
        openingYtd: emptyYtd({ SUT: 650_000, "FED-FUT": 650_000 }),
      }),
      FIXTURE_A_SETTINGS,
      FIXTURE_A_CHECK_DATE,
    );
    expect(check.employerTaxes.find((line) => line.code === "SUT")?.taxableCents).toBe(50_000);
    expect(amountOn(check, "SUT", "employer")).toBe(2_700);
    expect(amountOn(check, "FED-FUT", "employer")).toBe(300);
  });

  it("OASDI cap: opening 184000 + gross 1326.67 → taxable 500 → 31.00 ee/er", () => {
    const row = FIXTURE_A_ROWS[0];
    if (!row) throw new Error("missing A01");
    const check = computeCheck(
      explicitEmployee({
        employeeId: "A01",
        kind: "hourly",
        amountCents: row.regularOrSalaryCents,
        hoursHundredths: row.hoursHundredths,
        tipsCents: row.tipsCents,
        exemptionCents: 0,
        openingYtd: emptyYtd({ "FED-OASDI": 18_400_000 }),
      }),
      FIXTURE_A_SETTINGS,
      FIXTURE_A_CHECK_DATE,
    );
    expect(check.employeeWithholdings.find((line) => line.code === "FED-OASDI")?.taxableCents).toBe(50_000);
    expect(amountOn(check, "FED-OASDI")).toBe(3_100);
    expect(amountOn(check, "FED-OASDI", "employer")).toBe(3_100);
  });

  it("Additional Medicare: opening MED YTD 199000 + 1326.67 crosses 200000 → 326.67 * 0.9% = 2.94", () => {
    const row = FIXTURE_A_ROWS[0];
    if (!row) throw new Error("missing A01");
    const check = computeCheck(
      explicitEmployee({
        employeeId: "A01",
        kind: "hourly",
        amountCents: row.regularOrSalaryCents,
        hoursHundredths: row.hoursHundredths,
        tipsCents: row.tipsCents,
        exemptionCents: 0,
        openingYtd: emptyYtd({ "FED-MED": 19_900_000 }),
      }),
      FIXTURE_A_SETTINGS,
      FIXTURE_A_CHECK_DATE,
    );
    expect(amountOn(check, "FED-ADD-MED")).toBe(294);
    expect(check.employerTaxes.some((line) => line.code === "FED-ADD-MED")).toBe(false);
  });
});
