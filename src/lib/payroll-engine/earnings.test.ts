import { describe, expect, it } from "vitest";
import { PR_2026 } from "./data";
import { computeEarnings, overtimeHourlyRateCents } from "./earnings";
import type { EmployeePayInput } from "./types";

const payrollBase: Pick<EmployeePayInput, "employeeId" | "payType"> = {
  employeeId: "E01",
  payType: "payroll",
};

describe("tipped overtime rates", () => {
  it("cash $5.00, 1.5× → 15.75 − 5.50 = 10.25; 2h = 20.50", () => {
    const rate = overtimeHourlyRateCents({
      isTipped: true,
      regularRateCents: 500,
      cashRateCents: 500,
      multiplierPpm: 1_500_000,
      schedule: PR_2026,
    });
    expect(rate).toBe(1_025);
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: true,
        hourlyWeeks: [
          {
            workweekId: "w1",
            rateCents: 500,
            regularHoursHundredths: 0,
            dailyOtHoursHundredths: 200,
          },
        ],
      },
      PR_2026,
    );
    expect(earnings.lines[0]?.amountCents).toBe(2_050);
  });

  it("cash $3.00 tip credit 7.50 ≤ 8.37 → 15.75 − 7.50 = 8.25/h", () => {
    expect(
      overtimeHourlyRateCents({
        isTipped: true,
        regularRateCents: 300,
        cashRateCents: 300,
        multiplierPpm: 1_500_000,
        schedule: PR_2026,
      }),
    ).toBe(825);
  });

  it("cash $2.13 tip credit capped at 8.37 → 15.75 − 8.37 = 7.38/h", () => {
    expect(
      overtimeHourlyRateCents({
        isTipped: true,
        regularRateCents: 213,
        cashRateCents: 213,
        multiplierPpm: 1_500_000,
        schedule: PR_2026,
      }),
    ).toBe(738);
  });
});

describe("non-tipped overtime", () => {
  it("1.5× on $10.00 is $15.00", () => {
    expect(
      overtimeHourlyRateCents({
        isTipped: false,
        regularRateCents: 1_000,
        cashRateCents: 1_000,
        multiplierPpm: 1_500_000,
        schedule: PR_2026,
      }),
    ).toBe(1_500);
  });

  it("employee with 2.0× daily OT earns $20.00 on a $10.00 rate", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        dailyOtMultiplierPpm: 2_000_000,
        hourlyWeeks: [
          {
            workweekId: "w1",
            rateCents: 1_000,
            regularHoursHundredths: 0,
            dailyOtHoursHundredths: 100,
          },
        ],
      },
      PR_2026,
    );
    expect(earnings.lines[0]?.rateCents).toBe(2_000);
    expect(earnings.lines[0]?.amountCents).toBe(2_000);
  });
});

describe("minimum-wage make-up", () => {
  it("tipped $3.00 × 40h + $200 tips: required 420, actual 320, make-up 100", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: true,
        hourlyWeeks: [
          {
            workweekId: "w1",
            rateCents: 300,
            regularHoursHundredths: 4_000,
            tipsCents: 20_000,
          },
        ],
      },
      PR_2026,
    );
    const makeup = earnings.lines.filter((line) => line.kind === "min_wage_makeup");
    expect(makeup).toHaveLength(1);
    expect(makeup[0]?.amountCents).toBe(10_000);
  });

  it("does not offset a short week with a surplus week", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: true,
        hourlyWeeks: [
          {
            workweekId: "short",
            rateCents: 300,
            regularHoursHundredths: 4_000,
            tipsCents: 20_000,
          },
          {
            workweekId: "ok",
            rateCents: 300,
            regularHoursHundredths: 4_000,
            tipsCents: 40_000,
          },
        ],
      },
      PR_2026,
    );
    const makeup = earnings.lines.filter((line) => line.kind === "min_wage_makeup");
    expect(makeup).toHaveLength(1);
    expect(makeup[0]?.workweekId).toBe("short");
    expect(makeup[0]?.amountCents).toBe(10_000);
  });
});

describe("salary proration", () => {
  it("2550.00 × 8 / 14 = 1457.14", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        salary: { amountCents: 255_000, days: 8, periodDays: 14 },
      },
      PR_2026,
    );
    expect(earnings.lines[0]?.amountCents).toBe(145_714);
  });
});

describe("adjustment validation", () => {
  it("rejects an adjustment without a reason", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        earnings: [{ kind: "adjustment", amountCents: 100 }],
      },
      PR_2026,
    );
    expect(earnings.errors).toContain("Adjustment earnings require a non-empty reason");
    expect(earnings.lines).toHaveLength(0);
  });
});

describe("non-tipped under minimum", () => {
  it("emits a warning and does not add make-up", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: false,
        hourlyWeeks: [
          {
            workweekId: "w1",
            rateCents: 900,
            regularHoursHundredths: 1_000,
          },
        ],
      },
      PR_2026,
    );
    expect(earnings.warnings).toHaveLength(1);
    expect(earnings.lines.some((line) => line.kind === "min_wage_makeup")).toBe(false);
  });
});

describe("review fixes", () => {
  it("tipped cash $15.00 at 1.5× pays 22.50, not 15.75 − 0", () => {
    expect(
      overtimeHourlyRateCents({
        isTipped: true,
        regularRateCents: 1_500,
        cashRateCents: 1_500,
        multiplierPpm: 1_500_000,
        schedule: PR_2026,
      }),
    ).toBe(2_250);
  });

  it("two-rate tipped employee uses each position's cash rate: 30h × $3.00 + 10h × $8.50 + $200 tips = 375.00 vs 420.00 → 45.00", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: true,
        hourlyWeeks: [
          { workweekId: "w1", positionId: "server", rateCents: 300, regularHoursHundredths: 3_000, tipsCents: 20_000 },
          { workweekId: "w1", positionId: "bar", rateCents: 850, regularHoursHundredths: 1_000 },
        ],
      },
      PR_2026,
    );
    const makeup = earnings.lines.filter((line) => line.kind === "min_wage_makeup");
    expect(makeup.map((line) => line.amountCents)).toEqual([4_500]);
  });

  it("tipped OT hours count at straight-time cash in the weekly test: 42h × $3.00 = 126.00 + $300 tips = 426.00 vs 441.00 → 15.00", () => {
    const earnings = computeEarnings(
      {
        ...payrollBase,
        isTipped: true,
        hourlyWeeks: [
          { workweekId: "w1", rateCents: 300, regularHoursHundredths: 4_000, weeklyOtHoursHundredths: 200, tipsCents: 30_000 },
        ],
      },
      PR_2026,
    );
    const makeup = earnings.lines.filter((line) => line.kind === "min_wage_makeup");
    expect(makeup.map((line) => line.amountCents)).toEqual([1_500]);
  });
});
