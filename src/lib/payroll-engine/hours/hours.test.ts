import { describe, expect, it } from "vitest";
import { mealBreakFlags } from "./meal";
import { buildHourlyWeeks } from "./rates";
import { shiftsFromTimeEntries, workedIntervals } from "./shifts";
import { splitHours } from "./split";
import { isoFromSeconds, secondsToHoursHundredths, utcSecondsFromZoned } from "./time";
import type { HoursSplitSettings, ShiftBreak, WorkedShift } from "./types";

const TZ = "America/Puerto_Rico";

function localIso(ymd: string, time: string, timeZone = TZ): string {
  const [hourText, minuteText, secondText] = time.split(":");
  return isoFromSeconds(
    utcSecondsFromZoned({
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: Number(hourText),
      minute: Number(minuteText),
      second: Number(secondText ?? "0"),
      timeZone,
    }),
  );
}

function shift(input: {
  id: string;
  employeeId?: string;
  positionKey?: string;
  classId?: string;
  ymd: string;
  start: string;
  endYmd?: string;
  end: string;
  breaks?: ShiftBreak[];
  timeZone?: string;
}): WorkedShift {
  const timeZone = input.timeZone ?? TZ;
  return {
    id: input.id,
    employeeId: input.employeeId ?? "E1",
    positionKey: input.positionKey ?? "main",
    classId: input.classId ?? "r1",
    startedAt: localIso(input.ymd, input.start, timeZone),
    endedAt: localIso(input.endYmd ?? input.ymd, input.end, timeZone),
    breaks: input.breaks ?? [],
    source: "time_clock",
  };
}

function settings(overrides: Partial<HoursSplitSettings> = {}): HoursSplitSettings {
  return {
    timeZone: TZ,
    workweekStartDow: 0,
    workweekStartTime: "00:00",
    dailyWindow: "rolling_24h",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-11",
    ...overrides,
  };
}

function sumAlloc(
  allocations: Array<{ regularSeconds: number; dailyOtSeconds: number; weeklyOtSeconds: number; payable: boolean }>,
  payable = true,
) {
  return allocations
    .filter((row) => row.payable === payable)
    .reduce(
      (sum, row) => ({
        regular: sum.regular + row.regularSeconds,
        daily: sum.daily + row.dailyOtSeconds,
        weekly: sum.weekly + row.weeklyOtSeconds,
      }),
      { regular: 0, daily: 0, weekly: 0 },
    );
}

function hoursOf(seconds: { regular: number; daily: number; weekly: number }) {
  return {
    regular: secondsToHoursHundredths(seconds.regular) / 100,
    daily: secondsToHoursHundredths(seconds.daily) / 100,
    weekly: secondsToHoursHundredths(seconds.weekly) / 100,
  };
}

describe("shiftsFromTimeEntries", () => {
  it("maps position and restaurant_id and reports overlapping shifts", () => {
    const result = shiftsFromTimeEntries(
      [
        {
          id: "a",
          employee_id: "E1",
          restaurant_id: "r1",
          position: "cook",
          started_at: localIso("2026-10-01", "09:00"),
          ended_at: localIso("2026-10-01", "13:00"),
        },
        {
          id: "b",
          employee_id: "E1",
          restaurant_id: "r1",
          position: "cook",
          started_at: localIso("2026-10-01", "12:00"),
          ended_at: localIso("2026-10-01", "17:00"),
        },
      ],
      [],
    );
    expect(result.shifts[0]?.positionKey).toBe("cook");
    expect(result.shifts[0]?.classId).toBe("r1");
    expect(result.errors.some((error) => error.includes("overlapping"))).toBe(true);
  });
});

describe("splitHours", () => {
  it("rolling_24h: 4pm–midnight then next day 8am–4pm → second shift is entirely daily OT (8.00 h); calendar_day → 0 OT", () => {
    const shifts = [
      shift({ id: "s1", ymd: "2026-10-01", start: "16:00", endYmd: "2026-10-02", end: "00:00" }),
      shift({ id: "s2", ymd: "2026-10-02", start: "08:00", end: "16:00" }),
    ];
    const rolling = splitHours(shifts, settings({ dailyWindow: "rolling_24h" }));
    expect(hoursOf(sumAlloc(rolling.allocations.filter((row) => row.shiftId === "s2")))).toEqual({
      regular: 0,
      daily: 8,
      weekly: 0,
    });
    const calendar = splitHours(shifts, settings({ dailyWindow: "calendar_day" }));
    expect(hoursOf(sumAlloc(calendar.allocations))).toEqual({ regular: 16, daily: 0, weekly: 0 });
  });

  it("one 10 h shift → 2.00 daily OT", () => {
    const result = splitHours([shift({ id: "s1", ymd: "2026-10-01", start: "08:00", end: "18:00" })], settings());
    expect(hoursOf(sumAlloc(result.allocations))).toEqual({ regular: 8, daily: 2, weekly: 0 });
  });

  it("Mon–Fri 9 h at the same start → 5.00 daily OT, 0 weekly OT", () => {
    const shifts = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((ymd, index) =>
      shift({ id: `d${index}`, ymd, start: "09:00", end: "18:00" }),
    );
    const result = splitHours(shifts, settings());
    expect(hoursOf(sumAlloc(result.allocations))).toEqual({ regular: 40, daily: 5, weekly: 0 });
  });

  it("six 8 h days in one workweek → 8.00 weekly OT", () => {
    const days = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const shifts = days.map((ymd, index) => shift({ id: `d${index}`, ymd, start: "09:00", end: "17:00" }));
    const result = splitHours(shifts, settings());
    expect(hoursOf(sumAlloc(result.allocations))).toEqual({ regular: 40, daily: 0, weekly: 8 });
  });

  it("weekly counter resets at the workweek start (Sunday 00:00 local default)", () => {
    const weekOne = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map(
      (ymd, index) => shift({ id: `w1-${index}`, ymd, start: "09:00", end: "17:00" }),
    );
    const sunday = shift({ id: "sun", ymd: "2026-10-11", start: "09:00", end: "17:00" });
    const result = splitHours([...weekOne, sunday], settings());
    const sundayHours = hoursOf(sumAlloc(result.allocations.filter((row) => row.shiftId === "sun")));
    expect(sundayHours).toEqual({ regular: 8, daily: 0, weekly: 0 });
    expect(hoursOf(sumAlloc(result.allocations))).toEqual({ regular: 48, daily: 0, weekly: 8 });
  });

  it("lookback: period starts Wednesday; Sun–Tue 24 h count toward 40 but are not payable; Wed–Sat 24 h → 8 h weekly OT payable", () => {
    const lookback = ["2026-10-04", "2026-10-05", "2026-10-06"].map((ymd, index) =>
      shift({ id: `lb${index}`, ymd, start: "08:00", end: "16:00" }),
    );
    const payable = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((ymd, index) =>
      shift({ id: `p${index}`, ymd, start: "08:00", end: "14:00" }),
    );
    const result = splitHours([...lookback, ...payable], settings({ periodStart: "2026-10-07", periodEnd: "2026-10-10" }));
    expect(hoursOf(sumAlloc(result.allocations, false))).toEqual({ regular: 24, daily: 0, weekly: 0 });
    expect(hoursOf(sumAlloc(result.allocations, true))).toEqual({ regular: 16, daily: 0, weekly: 8 });
    expect(result.lookbackBuckets).toHaveLength(1);
    expect(result.payableBuckets[0]?.weeklyOtSeconds).toBe(8 * 3600);
  });

  it("two positions: OT is attributed to the position of the shift where it occurs; separate buckets per position and per rate change", () => {
    const shifts = [
      shift({ id: "cook1", positionKey: "cook", ymd: "2026-10-05", start: "08:00", end: "16:00" }),
      shift({ id: "bar1", positionKey: "bar", ymd: "2026-10-06", start: "08:00", end: "16:00" }),
      shift({ id: "cook2", positionKey: "cook", ymd: "2026-10-07", start: "08:00", end: "16:00" }),
      shift({ id: "bar2", positionKey: "bar", ymd: "2026-10-08", start: "08:00", end: "16:00" }),
      shift({ id: "cook3", positionKey: "cook", ymd: "2026-10-09", start: "08:00", end: "16:00" }),
      shift({ id: "bar3", positionKey: "bar", ymd: "2026-10-10", start: "08:00", end: "18:00" }),
    ];
    const split = splitHours(shifts, settings());
    const barOt = split.allocations.filter((row) => row.shiftId === "bar3");
    expect(hoursOf(sumAlloc(barOt))).toEqual({ regular: 0, daily: 2, weekly: 8 });
    const weeks = buildHourlyWeeks({
      shifts,
      allocations: split.allocations,
      timeZone: TZ,
      rates: [
        { employeeId: "E1", positionKey: "cook", rateCents: 1000, effectiveFrom: "2026-01-01" },
        { employeeId: "E1", positionKey: "bar", rateCents: 1200, effectiveFrom: "2026-01-01" },
        { employeeId: "E1", positionKey: "bar", rateCents: 1500, effectiveFrom: "2026-10-10" },
      ],
    });
    expect(weeks.errors).toEqual([]);
    const rows = weeks.weeks.get("E1") ?? [];
    expect(rows.map((row) => [row.positionId, row.rateCents, row.regularHoursHundredths, row.dailyOtHoursHundredths, row.weeklyOtHoursHundredths])).toEqual([
      ["bar", 1200, 1600, 0, 0],
      ["bar", 1500, 0, 200, 800],
      ["cook", 1000, 2400, 0, 0],
    ]);
  });

  it("unpaid breaks excluded, paid breaks counted", () => {
    const unpaid = shift({
      id: "unpaid",
      ymd: "2026-10-01",
      start: "08:00",
      end: "17:00",
      breaks: [
        {
          startedAt: localIso("2026-10-01", "12:00"),
          endedAt: localIso("2026-10-01", "13:00"),
          type: "meal",
          paid: false,
        },
      ],
    });
    const paid = shift({
      id: "paid",
      employeeId: "E2",
      ymd: "2026-10-01",
      start: "08:00",
      end: "17:00",
      breaks: [
        {
          startedAt: localIso("2026-10-01", "12:00"),
          endedAt: localIso("2026-10-01", "13:00"),
          type: "rest",
          paid: true,
        },
      ],
    });
    expect(workedIntervals(unpaid).reduce((sum, row) => sum + row.end - row.start, 0)).toBe(8 * 3600);
    expect(workedIntervals(paid).reduce((sum, row) => sum + row.end - row.start, 0)).toBe(9 * 3600);
    const result = splitHours([unpaid, paid], settings());
    expect(hoursOf(sumAlloc(result.allocations.filter((row) => row.shiftId === "unpaid")))).toEqual({
      regular: 8,
      daily: 0,
      weekly: 0,
    });
    expect(hoursOf(sumAlloc(result.allocations.filter((row) => row.shiftId === "paid")))).toEqual({
      regular: 8,
      daily: 1,
      weekly: 0,
    });
  });

  it("overnight shift across midnight and across the workweek boundary", () => {
    const overnight = shift({
      id: "ow",
      ymd: "2026-10-10",
      start: "22:00",
      endYmd: "2026-10-11",
      end: "06:00",
    });
    const result = splitHours([overnight], settings({ periodStart: "2026-10-04", periodEnd: "2026-10-11" }));
    const saturday = result.allocations.find((row) => row.workweekId === "2026-10-04");
    const sunday = result.allocations.find((row) => row.workweekId === "2026-10-11");
    expect(saturday?.regularSeconds).toBe(2 * 3600);
    expect(sunday?.regularSeconds).toBe(6 * 3600);
  });

  it("half-up rounding per bucket: 18 seconds → 0.01 h; 17 seconds → 0.00 h", () => {
    expect(secondsToHoursHundredths(18)).toBe(1);
    expect(secondsToHoursHundredths(17)).toBe(0);
    const result = splitHours(
      [shift({ id: "tiny", ymd: "2026-10-01", start: "08:00", end: "08:00:18" })],
      settings(),
    );
    const weeks = buildHourlyWeeks({
      shifts: [shift({ id: "tiny", ymd: "2026-10-01", start: "08:00", end: "08:00:18" })],
      allocations: result.allocations,
      timeZone: TZ,
      rates: [{ employeeId: "E1", positionKey: "main", rateCents: 1000, effectiveFrom: "2026-01-01" }],
    });
    expect(weeks.weeks.get("E1")?.[0]?.regularHoursHundredths).toBe(1);
  });
});

describe("buildHourlyWeeks", () => {
  it("missing rate → error; tips on a week with no hours → 0-hour row", () => {
    const worked = shift({ id: "s1", ymd: "2026-10-01", start: "08:00", end: "12:00" });
    const split = splitHours([worked], settings());
    const missing = buildHourlyWeeks({
      shifts: [worked],
      allocations: split.allocations,
      timeZone: TZ,
      rates: [],
    });
    expect(missing.errors.some((error) => error.includes("no rate"))).toBe(true);
    expect(missing.weeks.size).toBe(0);

    const tipsOnly = buildHourlyWeeks({
      shifts: [],
      allocations: [],
      timeZone: TZ,
      rates: [{ employeeId: "E1", positionKey: "main", rateCents: 1100, effectiveFrom: "2026-01-01" }],
      tips: [{ employeeId: "E1", workweekId: "2026-09-27", tipsCents: 2500 }],
    });
    expect(tipsOnly.errors).toEqual([]);
    expect(tipsOnly.weeks.get("E1")).toEqual([
      {
        workweekId: "2026-09-27",
        classId: null,
        positionId: "main",
        rateCents: 1100,
        regularHoursHundredths: 0,
        dailyOtHoursHundredths: 0,
        weeklyOtHoursHundredths: 0,
        tipsCents: 2500,
      },
    ]);
  });
});

describe("mealBreakFlags", () => {
  it("6 h no break → flag; 4 h → none; 7 h with a 30-min meal starting at 4 h → none; meal starting at 5.5 h → flag; 20-min meal → too short", () => {
    const six = shift({ id: "six", ymd: "2026-10-01", start: "08:00", end: "14:00" });
    const four = shift({ id: "four", employeeId: "E2", ymd: "2026-10-01", start: "08:00", end: "12:00" });
    const okMeal = shift({
      id: "ok",
      employeeId: "E3",
      ymd: "2026-10-01",
      start: "08:00",
      end: "15:30",
      breaks: [
        {
          startedAt: localIso("2026-10-01", "12:00"),
          endedAt: localIso("2026-10-01", "12:30"),
          type: "meal",
          paid: false,
        },
      ],
    });
    const lateMeal = shift({
      id: "late",
      employeeId: "E4",
      ymd: "2026-10-01",
      start: "08:00",
      end: "15:30",
      breaks: [
        {
          startedAt: localIso("2026-10-01", "13:30"),
          endedAt: localIso("2026-10-01", "14:00"),
          type: "meal",
          paid: false,
        },
      ],
    });
    const shortMeal = shift({
      id: "short",
      employeeId: "E5",
      ymd: "2026-10-01",
      start: "08:00",
      end: "12:00",
      breaks: [
        {
          startedAt: localIso("2026-10-01", "10:00"),
          endedAt: localIso("2026-10-01", "10:20"),
          type: "meal",
          paid: false,
        },
      ],
    });
    const flags = mealBreakFlags([six, four, okMeal, lateMeal, shortMeal]).flags;
    expect(flags.filter((row) => row.shiftId === "six")).toEqual([
      { shiftId: "six", employeeId: "E1", code: "meal_not_started_by_5h", atWorkedSeconds: 5 * 3600 },
    ]);
    expect(flags.filter((row) => row.shiftId === "four")).toEqual([]);
    expect(flags.filter((row) => row.shiftId === "ok")).toEqual([]);
    expect(flags.filter((row) => row.shiftId === "late")).toEqual([
      { shiftId: "late", employeeId: "E4", code: "meal_not_started_by_5h", atWorkedSeconds: 5 * 3600 },
    ]);
    expect(flags.filter((row) => row.shiftId === "short")).toEqual([
      { shiftId: "short", employeeId: "E5", code: "meal_too_short", atWorkedSeconds: 2 * 3600 },
    ]);
  });
});

describe("review regressions", () => {
  it("rolling daily OT keeps Saturday lookback across the first workweek start", () => {
    const lookback = shift({ id: "sat", ymd: "2026-10-03", start: "16:00", end: "23:00" });
    const sunday = shift({ id: "sun", ymd: "2026-10-04", start: "08:00", end: "16:00" });
    const result = splitHours(
      [lookback, sunday],
      settings({ periodStart: "2026-10-04", periodEnd: "2026-10-04" }),
    );
    expect(hoursOf(sumAlloc(result.allocations.filter((row) => row.shiftId === "sun")))).toEqual({
      regular: 1,
      daily: 7,
      weekly: 0,
    });
    expect(result.allocations.filter((row) => row.shiftId === "sat").every((row) => !row.payable)).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("daily OT at the period start may be understated"))).toBe(
      true,
    );
  });

  it("duplicate shift ids are errors and excluded from splitHours and buildHourlyWeeks", () => {
    const cook = shift({ id: "same", positionKey: "cook", ymd: "2026-10-05", start: "08:00", end: "12:00" });
    const server = shift({ id: "same", positionKey: "server", ymd: "2026-10-05", start: "13:00", end: "17:00" });
    const split = splitHours([cook, server], settings());
    expect(split.errors).toContain("Duplicate shift id same");
    expect(split.allocations).toEqual([]);
    const weeks = buildHourlyWeeks({
      shifts: [cook, server],
      allocations: split.allocations,
      timeZone: TZ,
      rates: [
        { employeeId: "E1", positionKey: "cook", rateCents: 2000, effectiveFrom: "2026-01-01" },
        { employeeId: "E1", positionKey: "server", rateCents: 1000, effectiveFrom: "2026-01-01" },
      ],
    });
    expect(weeks.errors).toContain("Duplicate shift id same");
    expect(weeks.weeks.size).toBe(0);
  });

  it("fall-back DST keeps later EST work in the Sunday 01:30 workweek", () => {
    const ny = "America/New_York";
    const edt: WorkedShift = {
      id: "edt",
      employeeId: "E1",
      positionKey: "main",
      classId: "r1",
      startedAt: "2026-11-01T05:30:00.000Z",
      endedAt: "2026-11-01T05:45:00.000Z",
      breaks: [],
      source: "time_clock",
    };
    const est: WorkedShift = {
      id: "est",
      employeeId: "E1",
      positionKey: "main",
      classId: "r1",
      startedAt: "2026-11-01T06:00:00.000Z",
      endedAt: "2026-11-01T06:15:00.000Z",
      breaks: [],
      source: "time_clock",
    };
    const result = splitHours(
      [edt, est],
      settings({
        timeZone: ny,
        workweekStartTime: "01:30",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-01",
        weeklyLimitSeconds: 900,
      }),
    );
    expect(result.allocations.map((row) => row.workweekId)).toEqual(["2026-11-01", "2026-11-01"]);
    expect(hoursOf(sumAlloc(result.allocations))).toEqual({ regular: 0.25, daily: 0, weekly: 0.25 });
  });

  it("rejects tips for a workweek outside the run", () => {
    const outside = buildHourlyWeeks({
      shifts: [],
      allocations: [],
      timeZone: TZ,
      rates: [{ employeeId: "E1", positionKey: "main", rateCents: 1000, effectiveFrom: "2026-01-01" }],
      tips: [{ employeeId: "E1", workweekId: "2030-01-01", tipsCents: 12345 }],
      period: {
        timeZone: TZ,
        workweekStartDow: 0,
        workweekStartTime: "00:00",
        periodStart: "2026-01-04",
        periodEnd: "2026-01-10",
      },
    });
    expect(outside.errors).toContain("Employee E1 has an unknown workweek 2030-01-01");
    expect(outside.weeks.size).toBe(0);

    const inside = buildHourlyWeeks({
      shifts: [],
      allocations: [],
      timeZone: TZ,
      rates: [{ employeeId: "E1", positionKey: "main", rateCents: 1000, effectiveFrom: "2026-01-01" }],
      tips: [{ employeeId: "E1", workweekId: "2026-01-04", tipsCents: 12345 }],
      period: {
        timeZone: TZ,
        workweekStartDow: 0,
        workweekStartTime: "00:00",
        periodStart: "2026-01-04",
        periodEnd: "2026-01-10",
      },
    });
    expect(inside.errors).toEqual([]);
    expect(inside.weeks.get("E1")?.[0]).toMatchObject({
      workweekId: "2026-01-04",
      regularHoursHundredths: 0,
      tipsCents: 12345,
    });
  });
});

describe("DST", () => {
  it("DST zone (America/New_York) shift across the spring-forward night counts real elapsed seconds", () => {
    const ny = "America/New_York";
    const spring = shift({
      id: "dst",
      ymd: "2026-03-08",
      start: "01:00",
      end: "04:00",
      timeZone: ny,
    });
    const elapsed = workedIntervals(spring).reduce((sum, row) => sum + row.end - row.start, 0);
    expect(elapsed).toBe(2 * 3600);
    const result = splitHours(
      [spring],
      settings({
        timeZone: ny,
        periodStart: "2026-03-08",
        periodEnd: "2026-03-08",
      }),
    );
    expect(result.allocations[0]?.regularSeconds).toBe(2 * 3600);
  });
});
