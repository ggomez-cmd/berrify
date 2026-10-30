import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../run";
import { amountOn } from "./helpers";
import { FIXTURE_L_CHECK_DATE, FIXTURE_L_ROWS, FIXTURE_L_SETTINGS, FIXTURE_L_TOTALS, fixtureLEmployees } from "./fixture-l";

describe("Fixture L biweekly table", () => {
  const run = computePayrollRun({
    checkDate: FIXTURE_L_CHECK_DATE,
    settings: FIXTURE_L_SETTINGS,
    employees: fixtureLEmployees(),
  });

  it.each(FIXTURE_L_ROWS)("$employeeId employee taxes match", (row) => {
    const check = run.checks.find((item) => item.employeeId === row.employeeId);
    expect(check).toBeDefined();
    if (!check) return;
    expect(check.grossCents).toBe(row.grossCents);
    expect(amountOn(check, "FED-OASDI")).toBe(row.oasdiCents);
    expect(amountOn(check, "FED-MED")).toBe(row.medCents);
    expect(amountOn(check, "DIE")).toBe(row.dieCents);
    expect(amountOn(check, "SWH")).toBe(row.swhCents);
    expect(check.netCents).toBe(row.netCents);
    expect(check.employerTaxes.length).toBeGreaterThan(0);
  });

  it("L04 and L06 keep two regular lines on one check", () => {
    const l04 = run.checks.find((check) => check.employeeId === "L04");
    const l06 = run.checks.find((check) => check.employeeId === "L06");
    expect(l04?.earnings.filter((line) => line.kind === "regular")).toHaveLength(2);
    expect(l06?.earnings.filter((line) => line.kind === "regular")).toHaveLength(2);
  });

  it("matches employee-side totals", () => {
    expect(run.payrollGrossCents).toBe(FIXTURE_L_TOTALS.grossCents);
    expect(run.employeeWithholdingsByCode.find((row) => row.code === "FED-OASDI")?.amountCents).toBe(
      FIXTURE_L_TOTALS.oasdiCents,
    );
    expect(run.employeeWithholdingsByCode.find((row) => row.code === "FED-MED")?.amountCents).toBe(
      FIXTURE_L_TOTALS.medCents,
    );
    expect(run.employeeWithholdingsByCode.find((row) => row.code === "DIE")?.amountCents).toBe(FIXTURE_L_TOTALS.dieCents);
    expect(run.employeeWithholdingsByCode.find((row) => row.code === "SWH")?.amountCents).toBe(FIXTURE_L_TOTALS.swhCents);
    expect(run.netPayCents).toBe(FIXTURE_L_TOTALS.netCents);
  });
});
