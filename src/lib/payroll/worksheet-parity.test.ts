import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computePayrollRun } from "../payroll-engine";
import { instantSeconds, isoFromSeconds, utcSecondsFromZoned, workweekIdsForPeriod } from "../payroll-engine/hours/time";
import type { WorkedShift } from "../payroll-engine/hours/types";
import type { PayrollCheck } from "../payroll-engine/types";
import type { PayrollEmployeeProfileRow, PayrollEmployerSettingsRow, PayrollPayRateRow } from "../types";
import { buildRunInput } from "./runs";

const TZ = "America/Puerto_Rico";
const timestamps = {
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

type FixturePeriod = {
  start: string;
  end: string;
  periodsPerYear: number;
  taxesViaAlchavo: boolean;
  mealDeductMode?: "top_up" | "skip_if_break";
};

type FixtureEmployee = {
  code: string;
  restaurant: string;
  payType: "payroll" | "cash";
  paymentMethod: string;
  rateCents: number;
  salaryCents: number | null;
  annualExemptionCents: number;
  fixedSwhCents: number | null;
};

type FixturePunch = {
  restaurant: string;
  employee: string;
  in: string;
  out: string;
  breakMinutes: number;
  sheetHoursHundredths: number;
};

type FixtureDay = {
  dayHoursHundredths: number;
  lunchHundredths: number;
  paidHundredths: number;
  otHundredths: number;
};

type FixtureExpected = {
  employee: string;
  restaurant: string;
  regularHundredths: number;
  otHundredths: number;
  hourlyPayCents: number;
  salaryCents: number;
  tipsCents: number;
  adjustmentCents: number;
  grossCents: number;
  ssCents: number;
  medicareCents: number;
  sdiCents: number;
  prCents: number;
  netCents: number;
  employer: {
    ssCents: number;
    medicareCents: number;
    futaCents: number;
    sutaCents: number;
    sinotCents: number;
  };
};

type WorksheetFixture = {
  periods: Record<string, FixturePeriod>;
  employees: FixtureEmployee[];
  punches: FixturePunch[];
  days: Record<string, FixtureDay>;
  tips: Array<{ restaurant: string; employee: string; tipsCents: number }>;
  adjustments: Array<{ restaurant: string; employee: string; amountCents: number; reason: string }>;
  expected: FixtureExpected[];
};

function loadFixture(): WorksheetFixture {
  const path =
    process.env.PAYROLL_WORKSHEET_FIXTURE ?? resolve("src/lib/payroll/fixtures/worksheet-sample.json");
  return JSON.parse(readFileSync(path, "utf8")) as WorksheetFixture;
}

function parseLocal(isoLocal: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(isoLocal);
  if (!match) {
    throw new Error(`Punch time must be local YYYY-MM-DDTHH:MM:SS, got ${isoLocal}`);
  }
  return isoFromSeconds(
    utcSecondsFromZoned({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
      timeZone: TZ,
    }),
  );
}

function employerRow(restaurant: string, period: FixturePeriod): PayrollEmployerSettingsRow {
  return {
    id: `set-${restaurant}`,
    org_id: "org-1",
    effective_from: "2026-01-01",
    sut_rate_bp: 540,
    swh_method: "annualized",
    pay_frequency: period.periodsPerYear === 52 ? "weekly" : "biweekly",
    daily_ot_mode: "clock_in_day",
    workweek_start_day: 0,
    time_zone: TZ,
    punch_rounding: "hundredth_hour",
    hourly_pay_rounding: "period",
    meal_deduct_after_minutes: 360,
    meal_deduct_minutes: 30,
    meal_deduct_mode: period.mealDeductMode ?? "top_up",
    notes: null,
    ...timestamps,
  };
}

function profileRow(employee: FixtureEmployee): PayrollEmployeeProfileRow {
  return {
    id: `p-${employee.code}`,
    org_id: "org-1",
    employee_id: employee.code,
    employee_number: employee.code,
    pay_type: employee.payType,
    is_tipped: false,
    hire_date: "2026-01-01",
    daily_ot_multiplier_ppm: 1_000_000,
    weekly_ot_multiplier_ppm: 1_000_000,
    default_restaurant_id: employee.restaurant,
    salary_cents: employee.salaryCents,
    personal_exemption: "none",
    veteran: false,
    dependents: 0,
    reduced_dependents: 0,
    deduction_cents: 0,
    annual_exemption_override_cents: employee.annualExemptionCents,
    biweekly_exemption_override_cents: null,
    young_worker_exempt: false,
    additional_withholding_cents: 0,
    fixed_swh_cents: employee.fixedSwhCents,
    payment_method: null,
    r41_effective_date: null,
    notes: null,
    ...timestamps,
  };
}

function rateRow(employee: FixtureEmployee): PayrollPayRateRow {
  return {
    id: `r-${employee.code}`,
    org_id: "org-1",
    employee_id: employee.code,
    restaurant_id: null,
    position: null,
    rate_cents: employee.rateCents,
    effective_from: "2026-01-01",
    ...timestamps,
  };
}

function punchToShift(punch: FixturePunch, index: number): WorkedShift | null {
  const startedAt = parseLocal(punch.in);
  const endedAt = parseLocal(punch.out);
  const start = instantSeconds(startedAt);
  const end = instantSeconds(endedAt);
  if (start === null || end === null || end <= start) return null;
  const breakSeconds = Math.max(0, Math.round(punch.breakMinutes * 60));
  const breaks =
    breakSeconds > 0 && end - start > breakSeconds
      ? [
          {
            startedAt: isoFromSeconds(start + Math.floor((end - start - breakSeconds) / 2)),
            endedAt: isoFromSeconds(start + Math.floor((end - start - breakSeconds) / 2) + breakSeconds),
            type: "meal" as const,
            paid: false,
          },
        ]
      : [];
  return {
    id: `${punch.restaurant}-${punch.employee}-${index}`,
    employeeId: punch.employee,
    positionKey: "main",
    classId: punch.restaurant,
    startedAt,
    endedAt,
    breaks,
    // Worksheet punches come from Clover, which reports its own paid hours per punch.
    source: "clover",
    reportedWorkedSeconds: punch.sheetHoursHundredths * 36,
  };
}

function taxAmount(check: PayrollCheck, code: PayrollCheck["employeeWithholdings"][number]["code"], side: "employee" | "employer"): number {
  const lines = side === "employee" ? check.employeeWithholdings : check.employerTaxes;
  return lines.filter((line) => line.code === code).reduce((sum, line) => sum + line.amountCents, 0);
}

function earningsAmount(check: PayrollCheck, kind: PayrollCheck["earnings"][number]["kind"]): number {
  return check.earnings.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountCents, 0);
}

function earningsHours(check: PayrollCheck, kind: PayrollCheck["earnings"][number]["kind"]): number {
  return check.earnings.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.hoursHundredths, 0);
}

type Diff = { code: string; field: string; expected: number; actual: number };

function addDiff(diffs: Diff[], code: string, field: string, expected: number, actual: number) {
  if (expected !== actual) diffs.push({ code, field, expected, actual });
}

function formatDiffs(diffs: readonly Diff[]): string {
  const header = `${"code".padEnd(8)} ${"field".padEnd(22)} ${"expected".padStart(10)} ${"actual".padStart(10)}`;
  const rows = diffs.map(
    (row) =>
      `${row.code.padEnd(8)} ${row.field.padEnd(22)} ${String(row.expected).padStart(10)} ${String(row.actual).padStart(10)}`,
  );
  return [header, ...rows].join("\n");
}

describe("worksheet parity", () => {
  it("matches the fixture hours, pay, and taxes", () => {
    const fixture = loadFixture();
    const diffs: Diff[] = [];

    for (const [restaurant, period] of Object.entries(fixture.periods)) {
      const employees = fixture.employees.filter((row) => row.restaurant === restaurant);
      // The sheet pays nothing for punches of someone with neither a rate nor a salary; it only flags them.
      const unpriced = new Set(
        employees.filter((row) => row.rateCents == null && row.salaryCents == null).map((row) => row.code),
      );
      const shifts = fixture.punches
        .filter((row) => row.restaurant === restaurant && !unpriced.has(row.employee))
        .map(punchToShift)
        .filter((row): row is WorkedShift => row !== null);
      const workweekIds = workweekIdsForPeriod({
        timeZone: TZ,
        workweekStartDow: 0,
        workweekStartTime: "00:00",
        periodStart: period.start,
        periodEnd: period.end,
      });
      const firstWeek = workweekIds[0];
      if (!firstWeek) throw new Error(`No workweeks for ${restaurant}`);

      const built = buildRunInput({
        checkDate: period.end,
        periodStart: period.start,
        periodEnd: period.end,
        hoursSource: "time_clock",
        employerSettingsRows: [employerRow(restaurant, period)],
        profiles: employees.map(profileRow),
        payRates: employees.filter((row) => row.salaryCents == null && row.rateCents != null).map(rateRow),
        shifts,
        tips: fixture.tips
          .filter((row) => row.restaurant === restaurant)
          .map((row) => ({ employeeId: row.employee, workweekId: firstWeek, tipsCents: row.tipsCents })),
        adjustments: fixture.adjustments
          .filter((row) => row.restaurant === restaurant)
          .map((row) => ({
            employeeId: row.employee,
            amountCents: row.amountCents,
            reason: row.reason,
            classId: restaurant,
          })),
      });
      const result = computePayrollRun(built.input);
      const runErrors = [...built.errors, ...result.errors];
      if (runErrors.length > 0) {
        diffs.push({ code: restaurant, field: "runErrors", expected: 0, actual: runErrors.length });
      }

      for (const expected of fixture.expected.filter((row) => row.restaurant === restaurant)) {
        const check = result.checks.find((row) => row.employeeId === expected.employee);
        if (!check) {
          if (expected.grossCents === 0) continue;
          diffs.push({ code: expected.employee, field: "missingCheck", expected: 1, actual: 0 });
          continue;
        }
        const input = built.input.employees.find((row) => row.employeeId === expected.employee);
        const regularHours = (input?.hourlyWeeks ?? []).reduce((sum, week) => sum + week.regularHoursHundredths, 0);
        const dailyOtHours = (input?.hourlyWeeks ?? []).reduce((sum, week) => sum + (week.dailyOtHoursHundredths ?? 0), 0);
        const weeklyOtHours = (input?.hourlyWeeks ?? []).reduce((sum, week) => sum + (week.weeklyOtHoursHundredths ?? 0), 0);
        const paidHours = regularHours + dailyOtHours + weeklyOtHours;
        const dayOt = Object.entries(fixture.days)
          .filter(([key]) => key.startsWith(`${restaurant}|${expected.employee}|`))
          .reduce((sum, [, day]) => sum + day.otHundredths, 0);

        addDiff(diffs, expected.employee, "paidHours", expected.regularHundredths + expected.otHundredths, paidHours);
        addDiff(diffs, expected.employee, "dailyOtHours", expected.otHundredths, dailyOtHours);
        addDiff(diffs, expected.employee, "sheetDailyOt", expected.otHundredths, dayOt || expected.otHundredths);
        addDiff(
          diffs,
          expected.employee,
          "hourlyPayCents",
          expected.hourlyPayCents,
          earningsAmount(check, "regular") + earningsAmount(check, "overtime"),
        );
        addDiff(diffs, expected.employee, "salaryCents", expected.salaryCents, earningsAmount(check, "salary"));
        addDiff(diffs, expected.employee, "tipsCents", expected.tipsCents, earningsAmount(check, "tips"));
        addDiff(diffs, expected.employee, "adjustmentCents", expected.adjustmentCents, earningsAmount(check, "adjustment"));
        addDiff(diffs, expected.employee, "grossCents", expected.grossCents, check.grossCents);
        if (expected.salaryCents > 0) {
          addDiff(diffs, expected.employee, "salaryHours", 0, earningsHours(check, "regular"));
        }
        addDiff(diffs, expected.employee, "ssCents", expected.ssCents, taxAmount(check, "FED-OASDI", "employee"));
        addDiff(diffs, expected.employee, "medicareCents", expected.medicareCents, taxAmount(check, "FED-MED", "employee"));
        addDiff(diffs, expected.employee, "sdiCents", expected.sdiCents, taxAmount(check, "DIE", "employee"));
        addDiff(diffs, expected.employee, "prCents", expected.prCents, taxAmount(check, "SWH", "employee"));
        addDiff(diffs, expected.employee, "netCents", expected.netCents, check.netCents);
        addDiff(diffs, expected.employee, "erSsCents", expected.employer.ssCents, taxAmount(check, "FED-OASDI", "employer"));
        addDiff(
          diffs,
          expected.employee,
          "erMedicareCents",
          expected.employer.medicareCents,
          taxAmount(check, "FED-MED", "employer"),
        );
        addDiff(diffs, expected.employee, "futaCents", expected.employer.futaCents, taxAmount(check, "FED-FUT", "employer"));
        addDiff(diffs, expected.employee, "sutaCents", expected.employer.sutaCents, taxAmount(check, "SUT", "employer"));
        addDiff(diffs, expected.employee, "sinotCents", expected.employer.sinotCents, taxAmount(check, "DIE", "employer"));
      }
    }

    if (diffs.length > 0) {
      const table = formatDiffs(diffs);
      console.error(table);
      expect.fail(`Worksheet parity mismatches:\n${table}`);
    }
  });
});
