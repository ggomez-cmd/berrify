import { describe, expect, it } from "vitest";
import {
  buildPayrollLines,
  countOpenPayrollIssues,
  hoursFromSeconds,
  lastCompletedWorkweek,
  listPayrollWorkweeks,
  payrollGross,
  punchInPeriod,
  splitWeeklyOvertime,
  WEEKLY_OT_THRESHOLD_SECONDS,
} from "./payroll";

const kane = "rest-kane";
const semilla = "rest-semilla";
const weekStart = new Date("2026-08-30T04:00:00.000Z");
const weekEnd = new Date("2026-09-06T04:00:00.000Z");

function punch(partial: {
  employee_id: string;
  restaurant_id?: string | null;
  started_at: string;
  worked_seconds: number;
}) {
  return {
    restaurant_id: kane,
    ...partial,
  };
}

describe("weekly overtime", () => {
  it("splits a 45-hour week into 40 regular and 5 OT", () => {
    const split = splitWeeklyOvertime(45 * 3600);
    expect(split.regular_seconds).toBe(40 * 3600);
    expect(split.ot_seconds).toBe(5 * 3600);
    expect(hoursFromSeconds(split.ot_seconds)).toBe(5);
  });

  it("keeps a 40-hour week at 0 OT", () => {
    const split = splitWeeklyOvertime(WEEKLY_OT_THRESHOLD_SECONDS);
    expect(split.regular_seconds).toBe(40 * 3600);
    expect(split.ot_seconds).toBe(0);
  });
});

describe("buildPayrollLines", () => {
  const employees = [
    { id: "emp-1", full_name: "Sofia Reyes", hourly_rate: 12 },
    { id: "emp-2", full_name: "Marco Diaz", hourly_rate: 16 },
    { id: "emp-3", full_name: "Nina Velez", hourly_rate: 0 },
  ];

  it("uses worked_seconds so an unpaid meal break is already out of hours", () => {
    const unpaidMeal = 30 * 60;
    const grossDay = 9 * 3600;
    const workedDay = grossDay - unpaidMeal;
    const days = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
    const punches = days.map((day) =>
      punch({
        employee_id: "emp-1",
        started_at: `${day}T12:00:00.000Z`,
        worked_seconds: workedDay,
      }),
    );
    const [line] = buildPayrollLines({
      punches,
      employees,
      restaurantId: kane,
      periodStart: weekStart,
      periodEnd: weekEnd,
    });
    expect(line.regular_seconds + line.ot_seconds).toBe(5 * workedDay);
    expect(line.regular_seconds).toBe(40 * 3600);
    expect(line.ot_seconds).toBe(5 * workedDay - 40 * 3600);
    expect(hoursFromSeconds(line.ot_seconds)).toBe(2.5);
    expect(line.gross).toBe(payrollGross(line.regular_seconds, line.ot_seconds, 12));
  });

  it("pays 45 worked hours as 40 regular plus 5 OT at 1.5×", () => {
    const days = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
    const punches = days.map((day) =>
      punch({
        employee_id: "emp-2",
        started_at: `${day}T14:00:00.000Z`,
        worked_seconds: 9 * 3600,
      }),
    );
    const [line] = buildPayrollLines({
      punches,
      employees,
      restaurantId: kane,
      periodStart: weekStart,
      periodEnd: weekEnd,
    });
    expect(hoursFromSeconds(line.regular_seconds)).toBe(40);
    expect(hoursFromSeconds(line.ot_seconds)).toBe(5);
    expect(line.hourly_rate).toBe(16);
    expect(line.gross).toBe(40 * 16 + 5 * 16 * 1.5);
  });

  it("keeps a $0 rate row visible and exports gross 0", () => {
    const lines = buildPayrollLines({
      punches: [
        punch({
          employee_id: "emp-3",
          started_at: "2026-09-01T12:00:00.000Z",
          worked_seconds: 8 * 3600,
        }),
      ],
      employees,
      restaurantId: kane,
      periodStart: weekStart,
      periodEnd: weekEnd,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].full_name).toBe("Nina Velez");
    expect(lines[0].hourly_rate).toBe(0);
    expect(lines[0].gross).toBe(0);
    expect(hoursFromSeconds(lines[0].regular_seconds)).toBe(8);
  });

  it("scopes hours to one restaurant and the selected workweek", () => {
    const punches = [
      punch({
        employee_id: "emp-1",
        started_at: "2026-09-01T12:00:00.000Z",
        worked_seconds: 8 * 3600,
      }),
      punch({
        employee_id: "emp-1",
        restaurant_id: semilla,
        started_at: "2026-09-02T12:00:00.000Z",
        worked_seconds: 10 * 3600,
      }),
      punch({
        employee_id: "emp-1",
        started_at: "2026-09-07T12:00:00.000Z",
        worked_seconds: 8 * 3600,
      }),
    ];
    const lines = buildPayrollLines({
      punches,
      employees,
      restaurantId: kane,
      periodStart: weekStart,
      periodEnd: weekEnd,
    });
    expect(lines).toHaveLength(1);
    expect(hoursFromSeconds(lines[0].regular_seconds)).toBe(8);
    expect(
      punchInPeriod(punches[1], kane, weekStart, weekEnd),
    ).toBe(false);
  });
});

describe("workweek defaults", () => {
  it("defaults to the last completed Puerto Rico Sunday week", () => {
    const now = new Date("2026-09-16T15:00:00.000Z");
    const last = lastCompletedWorkweek(now, "America/Puerto_Rico", 0, "00:00");
    expect(last.start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(last.end.toISOString()).toBe("2026-09-13T04:00:00.000Z");
    expect(last.inProgress).toBe(false);

    const weeks = listPayrollWorkweeks(now, "America/Puerto_Rico", 0, "00:00", 2);
    expect(weeks[0]).toEqual(last);
    expect(weeks[1]?.inProgress).toBe(true);
    expect(weeks[1]?.start.toISOString()).toBe("2026-09-13T04:00:00.000Z");
  });
});

describe("open payroll issues", () => {
  it("counts open exceptions on period entries and open sessions at the restaurant", () => {
    const counts = countOpenPayrollIssues({
      periodEntryIds: new Set(["entry-1"]),
      periodEmployeeIds: new Set(["emp-1"]),
      periodStart: weekStart,
      periodEnd: weekEnd,
      restaurantId: kane,
      exceptions: [
        {
          status: "open",
          employee_id: "emp-1",
          time_entry_id: "entry-1",
          created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          status: "resolved",
          employee_id: "emp-1",
          time_entry_id: "entry-1",
          created_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      sessions: [
        {
          employee_id: "emp-1",
          restaurant_id: kane,
          clocked_in_at: "2026-09-05T12:00:00.000Z",
        },
        {
          employee_id: "emp-2",
          restaurant_id: semilla,
          clocked_in_at: "2026-09-05T12:00:00.000Z",
        },
      ],
    });
    expect(counts.openExceptions).toBe(1);
    expect(counts.openSessions).toBe(1);
  });
});
