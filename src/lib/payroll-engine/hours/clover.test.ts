import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../run";
import { parseCloverShifts } from "./clover";
import { buildHourlyWeeks } from "./rates";
import { splitHours } from "./split";
import { secondsToHoursHundredths } from "./time";
import type { CloverNameMapping, HoursSplitSettings, WorkedShift } from "./types";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/clover-lelas-anon.csv"),
  "utf8",
);

const TZ = "America/Puerto_Rico";
const CLASS_ID = "lelas";

const mappedCodes = [
  "C01",
  "C02",
  "C03",
  "C04",
  "C05",
  "L01",
  "L02",
  "L03",
  "L04",
  "L05",
  "L06",
  "L07",
  "L08",
  "L10",
  "L11",
  "L12",
  "L13",
  "L14",
  "L15",
  "L16",
] as const;

function mapping(): Record<string, CloverNameMapping> {
  const rows: Record<string, CloverNameMapping> = {};
  for (const code of mappedCodes) {
    rows[code] = { employeeId: code, positionKey: "main", classId: CLASS_ID };
  }
  rows["L04 bar"] = { employeeId: "L04", positionKey: "bar", classId: CLASS_ID };
  rows["L06 bar"] = { employeeId: "L06", positionKey: "bar", classId: CLASS_ID };
  return rows;
}

function cloverSettings(dailyWindow: HoursSplitSettings["dailyWindow"]): HoursSplitSettings {
  return {
    timeZone: TZ,
    workweekStartDow: 0,
    workweekStartTime: "00:00",
    dailyWindow,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-11",
  };
}

function payableHoursByEmployee(shifts: WorkedShift[], dailyWindow: HoursSplitSettings["dailyWindow"]) {
  const split = splitHours(shifts, cloverSettings(dailyWindow));
  const weeks = buildHourlyWeeks({
    shifts,
    allocations: split.allocations,
    timeZone: TZ,
    rates: mappedCodes.map((code) => ({
      employeeId: code,
      positionKey: "main",
      rateCents: 1000,
      effectiveFrom: "2026-01-01",
    })).concat([
      { employeeId: "L04", positionKey: "bar", rateCents: 1100, effectiveFrom: "2026-01-01" },
      { employeeId: "L06", positionKey: "bar", rateCents: 1100, effectiveFrom: "2026-01-01" },
    ]),
  });
  const totals = new Map<string, { regular: number; daily: number; weekly: number }>();
  for (const [employeeId, rows] of weeks.weeks) {
    const sum = { regular: 0, daily: 0, weekly: 0 };
    for (const row of rows) {
      sum.regular += row.regularHoursHundredths;
      sum.daily += row.dailyOtHoursHundredths ?? 0;
      sum.weekly += row.weeklyOtHoursHundredths ?? 0;
    }
    totals.set(employeeId, sum);
  }
  return { split, weeks, totals };
}

const expectedPayable: Record<string, { regular: number; daily: number; weekly: number }> = {
  C01: { regular: 2248, daily: 38, weekly: 0 },
  C02: { regular: 3323, daily: 0, weekly: 0 },
  C03: { regular: 657, daily: 0, weekly: 0 },
  C04: { regular: 3090, daily: 0, weekly: 0 },
  C05: { regular: 408, daily: 0, weekly: 0 },
  L01: { regular: 5270, daily: 727, weekly: 0 },
  L02: { regular: 5792, daily: 87, weekly: 0 },
  L03: { regular: 3987, daily: 0, weekly: 0 },
  L04: { regular: 4144, daily: 92, weekly: 0 },
  L05: { regular: 3740, daily: 83, weekly: 0 },
  L06: { regular: 3492, daily: 0, weekly: 0 },
  L07: { regular: 782, daily: 0, weekly: 0 },
  L08: { regular: 2682, daily: 0, weekly: 0 },
  L10: { regular: 4206, daily: 112, weekly: 0 },
  L11: { regular: 1388, daily: 0, weekly: 0 },
  L12: { regular: 4213, daily: 0, weekly: 0 },
  L13: { regular: 1523, daily: 0, weekly: 0 },
  L14: { regular: 2183, daily: 170, weekly: 0 },
  L15: { regular: 2887, daily: 0, weekly: 0 },
  L16: { regular: 3311, daily: 0, weekly: 0 },
};

describe("parseCloverShifts fixture", () => {
  const parsed = parseCloverShifts({
    csv: fixture,
    timeZone: TZ,
    mapping: mapping(),
    ignore: ["X01", "X02", "X03"],
  });

  it("has no unmatched names and reconciles every Totals for row plus the 644.07 grand total", () => {
    expect(parsed.period).toEqual({ start: "2026-10-01", end: "2026-10-11" });
    expect(parsed.report.unmatchedNames).toEqual([]);
    expect(parsed.report.ignored.map((row) => row.name)).toEqual(["X01", "X02", "X03"]);
    expect(parsed.report.reconciliations.filter((row) => row.warning)).toEqual([]);
    expect(parsed.report.grandCloverHoursHundredths).toBe(64407);
    expect(Math.abs(parsed.report.grandParsedHoursHundredths - 64407)).toBeLessThanOrEqual(1);
  });

  it("rolling_24h payable hours match the independently computed table", () => {
    const { totals, weeks } = payableHoursByEmployee(parsed.shifts, "rolling_24h");
    expect(weeks.errors).toEqual([]);
    const disagreements: string[] = [];
    let grand = 0;
    for (const employeeId of Object.keys(expectedPayable).sort()) {
      const expected = expectedPayable[employeeId];
      const actual = totals.get(employeeId) ?? { regular: 0, daily: 0, weekly: 0 };
      grand += actual.regular + actual.daily + actual.weekly;
      if (!expected) continue;
      if (actual.regular !== expected.regular || actual.daily !== expected.daily || actual.weekly !== expected.weekly) {
        disagreements.push(
          `${employeeId}: got ${(actual.regular / 100).toFixed(2)} / ${(actual.daily / 100).toFixed(2)} / ${(actual.weekly / 100).toFixed(2)} expected ${(expected.regular / 100).toFixed(2)} / ${(expected.daily / 100).toFixed(2)} / ${(expected.weekly / 100).toFixed(2)}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
    expect(grand).toBe(60635);
  });

  it("calendar_day differs from rolling_24h on the fixture (L02 daily OT; L01 totals stay equal)", () => {
    const rolling = payableHoursByEmployee(parsed.shifts, "rolling_24h").totals;
    const calendar = payableHoursByEmployee(parsed.shifts, "calendar_day").totals;
    expect(calendar.get("L01")).toEqual(rolling.get("L01"));
    expect(calendar.get("L02")?.daily).not.toBe(rolling.get("L02")?.daily);
  });

  it("feeds L-employee hourly weeks through computePayrollRun with no errors", () => {
    const { weeks } = payableHoursByEmployee(parsed.shifts, "rolling_24h");
    const employees = [...weeks.weeks.entries()]
      .filter(([employeeId]) => employeeId.startsWith("L"))
      .map(([employeeId, hourlyWeeks]) => ({
        employeeId,
        payType: "payroll" as const,
        hourlyWeeks,
      }));
    const run = computePayrollRun({
      checkDate: "2026-10-23",
      settings: { sutRateBp: 540, swhMethod: "annualized", payFrequency: "biweekly" },
      employees,
    });
    expect(run.errors).toEqual([]);
    expect(run.checks.length).toBe(employees.length);
  });
});

describe("Clover parsing details", () => {
  it("locates columns by header name and accepts ISO dates plus 24-hour times", () => {
    const csv = [
      "Cafe",
      "Payroll Period,2026-10-01 To 2026-10-02",
      "Role,Name,Clock out time,Clock in time,Clock out date,Clock in date,Total paid hours",
      "Cook,Pat,17:00,09:00,2026-10-01,2026-10-01,8.00",
      "Totals for Pat,,,,,,,8.00",
      "Totals,,,,,,,8.00",
    ].join("\n");
    const result = parseCloverShifts({
      csv,
      timeZone: TZ,
      mapping: { Pat: { employeeId: "P1", positionKey: "cook", classId: "r1" } },
      ignore: [],
    });
    expect(result.report.errors).toEqual([]);
    expect(result.shifts).toHaveLength(1);
    expect(secondsToHoursHundredths(
      Math.floor(Date.parse(result.shifts[0]?.endedAt ?? "") / 1000) -
        Math.floor(Date.parse(result.shifts[0]?.startedAt ?? "") / 1000),
    )).toBe(800);
  });
});
