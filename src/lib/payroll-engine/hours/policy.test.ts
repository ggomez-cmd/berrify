import { describe, expect, it } from "vitest";
import { applyHoursPolicy, roundSecondsToHundredthHour } from "./policy";
import { workedIntervals } from "./shifts";
import { instantSeconds, isoFromSeconds, utcSecondsFromZoned } from "./time";
import type { ShiftBreak, WorkedShift } from "./types";

const TZ = "America/Puerto_Rico";

function localIso(ymd: string, time: string): string {
  const [hourText, minuteText, secondText] = time.split(":");
  return isoFromSeconds(
    utcSecondsFromZoned({
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: Number(hourText),
      minute: Number(minuteText),
      second: Number(secondText ?? "0"),
      timeZone: TZ,
    }),
  );
}

function shift(input: {
  id: string;
  employeeId?: string;
  classId?: string;
  ymd: string;
  start: string;
  endYmd?: string;
  end: string;
  breaks?: ShiftBreak[];
}): WorkedShift {
  return {
    id: input.id,
    employeeId: input.employeeId ?? "E1",
    positionKey: "main",
    classId: input.classId ?? "r1",
    startedAt: localIso(input.ymd, input.start),
    endedAt: localIso(input.endYmd ?? input.ymd, input.end),
    breaks: input.breaks ?? [],
    source: "time_clock",
  };
}

function workedSeconds(row: WorkedShift): number {
  return workedIntervals(row).reduce((sum, interval) => sum + interval.end - interval.start, 0);
}

describe("punch rounding", () => {
  it("rounds half-up at the 18-second edge to 36 seconds", () => {
    expect(roundSecondsToHundredthHour(18)).toBe(36);
    expect(roundSecondsToHundredthHour(17)).toBe(0);
    const edge = applyHoursPolicy([shift({ id: "edge", ymd: "2026-10-01", start: "08:00:00", end: "08:00:18" })], {
      timeZone: TZ,
      punchRounding: "hundredth_hour",
    });
    expect(workedSeconds(edge.shifts[0]!)).toBe(36);
    const under = applyHoursPolicy([shift({ id: "under", ymd: "2026-10-01", start: "08:00:00", end: "08:00:17" })], {
      timeZone: TZ,
      punchRounding: "hundredth_hour",
    });
    expect(workedSeconds(under.shifts[0]!)).toBe(0);
  });

  it("uses the source's reported hours when they are within 0.02 h of the punch times", () => {
    // 9:47–16:34 less a 7-minute break is 6.6667 h; Clover reported 6.66 h.
    const punch = {
      ...shift({ id: "c1", ymd: "2026-10-18", start: "09:47:00", end: "16:34:00" }),
      breaks: [
        { startedAt: localIso("2026-10-18", "12:00:00"), endedAt: localIso("2026-10-18", "12:07:00"), type: "rest" as const, paid: false },
      ],
    };
    const close = applyHoursPolicy([{ ...punch, reportedWorkedSeconds: 666 * 36 }], {
      timeZone: TZ,
      punchRounding: "hundredth_hour",
    });
    expect(workedSeconds(close.shifts[0]!)).toBe(666 * 36);
    const far = applyHoursPolicy([{ ...punch, reportedWorkedSeconds: 600 * 36 }], {
      timeZone: TZ,
      punchRounding: "hundredth_hour",
    });
    expect(workedSeconds(far.shifts[0]!)).toBe(667 * 36);
  });

  it("leaves timestamps unchanged when rounding is off", () => {
    const original = shift({ id: "s1", ymd: "2026-10-01", start: "08:00:00", end: "08:00:18" });
    const result = applyHoursPolicy([original], { timeZone: TZ });
    expect(result.shifts[0]?.endedAt).toBe(original.endedAt);
    expect(workedSeconds(result.shifts[0]!)).toBe(18);
  });
});

describe("automatic lunch deduction", () => {
  const mealDeduction = { afterSeconds: 6 * 3600, deductSeconds: 30 * 60 };

  it("deducts a full 30 minutes when the day is over 6 h with no break", () => {
    const result = applyHoursPolicy(
      [shift({ id: "s1", ymd: "2026-10-07", start: "14:55:30", end: "22:31:00" })],
      { timeZone: TZ, punchRounding: "hundredth_hour", mealDeduction },
    );
    expect(workedSeconds(result.shifts[0]!)).toBe(25_524);
    expect(result.lunchDeductions).toEqual([{ employeeId: "E1", ymd: "2026-10-07", seconds: 1800 }]);
  });

  it("deducts 12 minutes when the day has an 18-minute gap", () => {
    const result = applyHoursPolicy(
      [
        shift({ id: "a", ymd: "2026-10-08", start: "11:00:00", end: "15:00:00" }),
        shift({ id: "b", ymd: "2026-10-08", start: "15:18:00", end: "19:00:00" }),
      ],
      { timeZone: TZ, punchRounding: "hundredth_hour", mealDeduction },
    );
    expect(workedSeconds(result.shifts[0]!) + workedSeconds(result.shifts[1]!)).toBe(27_000);
    expect(result.lunchDeductions).toEqual([{ employeeId: "E1", ymd: "2026-10-08", seconds: 720 }]);
  });

  it("deducts nothing when a 30-minute unpaid break was already taken", () => {
    const result = applyHoursPolicy(
      [
        shift({
          id: "s1",
          ymd: "2026-10-09",
          start: "10:00:00",
          end: "18:00:00",
          breaks: [
            {
              startedAt: localIso("2026-10-09", "13:45:00"),
              endedAt: localIso("2026-10-09", "14:15:00"),
              type: "meal",
              paid: false,
            },
          ],
        }),
      ],
      { timeZone: TZ, punchRounding: "hundredth_hour", mealDeduction },
    );
    expect(workedSeconds(result.shifts[0]!)).toBe(7.5 * 3600);
    expect(result.warnings).toEqual([]);
  });

  it("deducts nothing on a day of exactly 6 h", () => {
    const result = applyHoursPolicy([shift({ id: "s1", ymd: "2026-10-10", start: "12:00:00", end: "18:00:00" })], {
      timeZone: TZ,
      punchRounding: "hundredth_hour",
      mealDeduction,
    });
    expect(workedSeconds(result.shifts[0]!)).toBe(6 * 3600);
    expect(result.warnings).toEqual([]);
  });

  it("spills a deduction into the previous shift and never goes below zero", () => {
    const long: WorkedShift = {
      id: "long",
      employeeId: "E1",
      positionKey: "main",
      classId: "r1",
      startedAt: "2026-10-01T12:00:00.000Z",
      endedAt: "2026-10-01T18:00:00.000Z",
      breaks: [],
      source: "time_clock",
    };
    const short: WorkedShift = {
      id: "short",
      employeeId: "E1",
      positionKey: "main",
      classId: "r1",
      startedAt: "2026-10-01T18:00:00.000Z",
      endedAt: "2026-10-01T18:20:00.000Z",
      breaks: [],
      source: "time_clock",
    };
    const result = applyHoursPolicy([long, short], { timeZone: TZ, mealDeduction });
    expect(workedSeconds(result.shifts[1]!)).toBe(0);
    expect(workedSeconds(result.shifts[0]!)).toBe(6 * 3600 - 600);
    expect(instantSeconds(result.shifts[1]!.breaks[0]!.startedAt)).toBe(instantSeconds(result.shifts[1]!.startedAt));
  });
});
