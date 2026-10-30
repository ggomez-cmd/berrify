import { describe, expect, it } from "vitest";
import { computeCheck } from "./check";
import { PR_2026, selectTaxSchedule } from "./data";
import { computeEarnings } from "./earnings";
import { emptyYtd, overrideExemption } from "./fixtures/helpers";
import { computePayrollRun } from "./run";
import type { ClosingYtd, EmployeePayInput, EmployerSettings, OpeningYtd, PayrollCheck, TaxCode } from "./types";

const settings: EmployerSettings = { sutRateBp: 540, swhMethod: "annualized", payFrequency: "biweekly" };
const checkDate = "2026-10-23";

function tax(check: PayrollCheck, code: TaxCode, side: "employee" | "employer" = "employee"): number {
  const lines = side === "employee" ? check.employeeWithholdings : check.employerTaxes;
  return lines.find((line) => line.code === code)?.amountCents ?? 0;
}

function toOpening(closing: ClosingYtd): OpeningYtd {
  return { grossCents: closing.grossCents, taxableCents: closing.taxableCents, withheldCents: closing.withheldCents };
}

function hourly(employeeId: string, amountCents: number, extra?: Partial<EmployeePayInput>): EmployeePayInput {
  return {
    employeeId,
    payType: "payroll",
    exemption: overrideExemption(0),
    openingYtd: emptyYtd(),
    earnings: [{ kind: "regular", amountCents }],
    ...extra,
  };
}

describe("tipped input must be weekly", () => {
  it("rejects explicit tipped overtime hours instead of skipping them in the minimum-wage test", () => {
    const result = computeEarnings(
      {
        employeeId: "T01",
        payType: "payroll",
        isTipped: true,
        earnings: [{ kind: "overtime", hoursHundredths: 200, rateCents: 825, workweekId: "w1" }],
      },
      PR_2026,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.lines).toHaveLength(0);
  });

  it("rejects a supplied make-up line for tipped employees", () => {
    const result = computeEarnings(
      {
        employeeId: "T01",
        payType: "payroll",
        isTipped: true,
        earnings: [{ kind: "min_wage_makeup", amountCents: 10_000, workweekId: "w1" }],
      },
      PR_2026,
    );
    expect(result.errors).toHaveLength(1);
  });

  it("rejects tipped tips without a workweek so weeks cannot offset", () => {
    const result = computeEarnings(
      { employeeId: "T01", payType: "payroll", isTipped: true, earnings: [{ kind: "tips", amountCents: 20_000 }] },
      PR_2026,
    );
    expect(result.errors).toHaveLength(1);
  });

  it("explicit weekly tips count toward that week: 40h × $3 + $300 tips = 420.00 → no make-up", () => {
    const result = computeEarnings(
      {
        employeeId: "T01",
        payType: "payroll",
        isTipped: true,
        hourlyWeeks: [{ workweekId: "w1", rateCents: 300, regularHoursHundredths: 4_000 }],
        earnings: [{ kind: "tips", amountCents: 30_000, workweekId: "w1" }],
      },
      PR_2026,
    );
    expect(result.errors).toEqual([]);
    expect(result.lines.some((line) => line.kind === "min_wage_makeup")).toBe(false);
  });
});

describe("input validation", () => {
  it("rejects amount that contradicts hours × rate: 40h × $3.00 ≠ $100.00", () => {
    const result = computeEarnings(
      {
        employeeId: "E01",
        payType: "payroll",
        earnings: [{ kind: "regular", hoursHundredths: 4_000, rateCents: 300, amountCents: 10_000 }],
      },
      PR_2026,
    );
    expect(result.errors).toHaveLength(1);
  });

  it("rejects negative weekly hours and tips instead of dropping them silently", () => {
    const result = computeEarnings(
      {
        employeeId: "E01",
        payType: "payroll",
        hourlyWeeks: [{ workweekId: "w1", rateCents: 1_050, regularHoursHundredths: -1_000, tipsCents: -500 }],
      },
      PR_2026,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.lines).toHaveLength(0);
  });

  it("rejects invalid check dates", () => {
    expect(() => selectTaxSchedule("not-a-date")).toThrow();
    expect(() => selectTaxSchedule("2026-02-30")).toThrow();
    expect(selectTaxSchedule("2026-02-28").id).toBe("pr-2026");
  });

  it("rejects duplicate employee IDs in a run", () => {
    expect(() =>
      computePayrollRun({ checkDate, settings, employees: [hourly("X01", 40_000), hourly("X01", 40_000)] }),
    ).toThrow(/more than once/);
  });

  it("negative gross is an error and leaves tax YTD untouched", () => {
    const opening = emptyYtd({ "FED-OASDI": 100_000, SUT: 100_000 });
    const check = computeCheck(
      hourly("E01", 0, {
        openingYtd: { ...opening, grossCents: 100_000 },
        earnings: [{ kind: "adjustment", amountCents: -100_000, reason: "Reverse duplicate check" }],
      }),
      settings,
      checkDate,
    );
    expect(check.errors.some((error) => error.includes("Negative gross"))).toBe(true);
    expect(check.employeeWithholdings).toEqual([]);
    expect(check.closingYtd.grossCents).toBe(100_000);
    expect(check.closingYtd.taxableCents["FED-OASDI"]).toBe(100_000);
  });
});

describe("overtime is rounded once", () => {
  it("10h × $10.51 × 1.5 = 157.65 (not 10 × 15.77)", () => {
    const result = computeEarnings(
      {
        employeeId: "E01",
        payType: "payroll",
        hourlyWeeks: [{ workweekId: "w1", rateCents: 1_051, regularHoursHundredths: 0, weeklyOtHoursHundredths: 1_000 }],
      },
      PR_2026,
    );
    expect(result.lines[0]?.amountCents).toBe(15_765);
  });
});

describe("young-worker exemption", () => {
  it("keeps voluntary additional withholding: table SWH 0 + $10.00 requested = 10.00", () => {
    const check = computeCheck(
      hourly("Y01", 100_000, { youngWorkerExempt: true, additionalWithholdingCents: 1_000 }),
      settings,
      checkDate,
    );
    expect(tax(check, "SWH")).toBe(1_000);
  });
});

describe("runs and YTD carry-forward", () => {
  it("mixed payroll and cash: cash stays out of net pay and liabilities", () => {
    const run = computePayrollRun({
      checkDate,
      settings,
      employees: [hourly("P01", 100_000), { employeeId: "C01", payType: "cash", earnings: [{ kind: "regular", amountCents: 50_000 }] }],
    });
    expect(run.payrollGrossCents).toBe(100_000);
    expect(run.cashTotalCents).toBe(50_000);
    expect(run.netPayCents).toBe(run.checks[0]?.netCents);
    expect(run.employerCostCents).toBe(100_000 + run.employerTaxCents);
    expect(run.scheduleId).toBe("pr-2026");
    expect(run.checks[0]?.taxYear).toBe(2026);
  });

  it("three sequential $4,000 checks cross the $7,000 SUT base: 4,000 → 3,000 → 0 taxable", () => {
    let opening: OpeningYtd = emptyYtd();
    const sutTaxable: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const check = computeCheck(hourly("S01", 400_000, { openingYtd: opening }), settings, checkDate);
      sutTaxable.push(check.employerTaxes.find((line) => line.code === "SUT")?.taxableCents ?? -1);
      opening = toOpening(check.closingYtd);
    }
    expect(sutTaxable).toEqual([400_000, 300_000, 0]);
    expect(opening.taxableCents.SUT).toBe(700_000);
  });
});
