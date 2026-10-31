import { collectOverlapErrors, validateShift, workedIntervals, type Interval } from "./shifts";
import {
  addCalendarDays,
  DEFAULT_DAILY_LIMIT_SECONDS,
  DEFAULT_WEEKLY_LIMIT_SECONDS,
  isHm,
  isYmd,
  localMidnightSeconds,
  nextLocalMidnightSeconds,
  nextWorkweekStartSeconds,
  SECONDS_PER_DAY,
  startOfWorkweekSeconds,
  ymdInTimeZone,
} from "./time";
import type {
  HoursBucket,
  HoursSplitResult,
  HoursSplitSettings,
  ShiftAllocation,
  WorkedShift,
} from "./types";

type PreparedShift = {
  shift: WorkedShift;
  intervals: Interval[];
};

type AllocationKey = string;

function allocationKey(row: Omit<ShiftAllocation, "regularSeconds" | "dailyOtSeconds" | "weeklyOtSeconds">): AllocationKey {
  return `${row.shiftId}\t${row.workweekId}\t${row.payable ? "1" : "0"}`;
}

function bucketKey(row: Omit<HoursBucket, "regularSeconds" | "dailyOtSeconds" | "weeklyOtSeconds">): string {
  return `${row.employeeId}\t${row.workweekId}\t${row.positionKey}\t${row.classId}`;
}

function addSeconds(
  target: { regularSeconds: number; dailyOtSeconds: number; weeklyOtSeconds: number },
  regularSeconds: number,
  dailyOtSeconds: number,
  weeklyOtSeconds: number,
): void {
  target.regularSeconds += regularSeconds;
  target.dailyOtSeconds += dailyOtSeconds;
  target.weeklyOtSeconds += weeklyOtSeconds;
}

function validateSettings(settings: HoursSplitSettings, errors: string[]): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone }).format(new Date());
  } catch {
    errors.push(`Unknown time zone ${settings.timeZone}`);
    return false;
  }
  if (!Number.isInteger(settings.workweekStartDow) || settings.workweekStartDow < 0 || settings.workweekStartDow > 6) {
    errors.push("workweekStartDow must be an integer 0-6");
    return false;
  }
  if (!isHm(settings.workweekStartTime)) {
    errors.push("workweekStartTime must be HH:MM");
    return false;
  }
  if (!isYmd(settings.periodStart) || !isYmd(settings.periodEnd)) {
    errors.push("periodStart and periodEnd must be local YYYY-MM-DD dates");
    return false;
  }
  if (settings.periodEnd < settings.periodStart) {
    errors.push("periodEnd is before periodStart");
    return false;
  }
  if (settings.dailyWindow !== "rolling_24h" && settings.dailyWindow !== "calendar_day") {
    errors.push("dailyWindow must be rolling_24h or calendar_day");
    return false;
  }
  const dailyLimit = settings.dailyLimitSeconds ?? DEFAULT_DAILY_LIMIT_SECONDS;
  const weeklyLimit = settings.weeklyLimitSeconds ?? DEFAULT_WEEKLY_LIMIT_SECONDS;
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0) {
    errors.push("dailyLimitSeconds must be a non-negative integer");
    return false;
  }
  if (!Number.isSafeInteger(weeklyLimit) || weeklyLimit < 0) {
    errors.push("weeklyLimitSeconds must be a non-negative integer");
    return false;
  }
  return true;
}

function nextSplit(
  start: number,
  end: number,
  settings: HoursSplitSettings,
  windowEnd: number | null,
): number {
  let next = end;
  const midnight = nextLocalMidnightSeconds(start, settings.timeZone);
  if (midnight > start && midnight < next) next = midnight;
  const weekStart = nextWorkweekStartSeconds(
    start,
    settings.timeZone,
    settings.workweekStartDow,
    settings.workweekStartTime,
  );
  if (weekStart > start && weekStart < next) next = weekStart;
  if (settings.dailyWindow === "rolling_24h" && windowEnd !== null && windowEnd > start && windowEnd < next) {
    next = windowEnd;
  }
  return next;
}

export function splitHours(shifts: readonly WorkedShift[], settings: HoursSplitSettings): HoursSplitResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!validateSettings(settings, errors)) {
    return { allocations: [], payableBuckets: [], lookbackBuckets: [], warnings, errors };
  }

  const valid: PreparedShift[] = [];
  for (const shift of shifts) {
    if (!validateShift(shift, errors)) continue;
    valid.push({ shift, intervals: workedIntervals(shift) });
  }
  collectOverlapErrors(
    valid.map((row) => row.shift),
    errors,
  );

  const dailyLimit = settings.dailyLimitSeconds ?? DEFAULT_DAILY_LIMIT_SECONDS;
  const weeklyLimit = settings.weeklyLimitSeconds ?? DEFAULT_WEEKLY_LIMIT_SECONDS;
  const periodStart = localMidnightSeconds(settings.periodStart, settings.timeZone);
  const periodEnd = localMidnightSeconds(addCalendarDays(settings.periodEnd, 1), settings.timeZone);
  const firstWeekStart = startOfWorkweekSeconds(
    periodStart,
    settings.timeZone,
    settings.workweekStartDow,
    settings.workweekStartTime,
  );

  const allocations = new Map<AllocationKey, ShiftAllocation>();
  const payableBuckets = new Map<string, HoursBucket>();
  const lookbackBuckets = new Map<string, HoursBucket>();

  const byEmployee = new Map<string, PreparedShift[]>();
  for (const row of valid) {
    const list = byEmployee.get(row.shift.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.shift.employeeId, list);
  }

  for (const [, employeeShifts] of byEmployee) {
    const pieces: Array<{ shift: WorkedShift; start: number; end: number }> = [];
    for (const row of employeeShifts) {
      for (const interval of row.intervals) {
        pieces.push({ shift: row.shift, start: interval.start, end: interval.end });
      }
    }
    pieces.sort((a, b) => a.start - b.start || a.end - b.end || a.shift.id.localeCompare(b.shift.id));

    let windowEnd: number | null = null;
    let windowWorked = 0;
    let calendarDay: string | null = null;
    let weekStart = Number.NaN;
    let weekNonDaily = 0;

    for (const piece of pieces) {
      let cursor = piece.start;
      while (cursor < piece.end) {
        if (cursor >= periodEnd) break;
        if (cursor < firstWeekStart) {
          const jump = Math.min(piece.end, firstWeekStart);
          cursor = jump;
          continue;
        }

        if (settings.dailyWindow === "rolling_24h") {
          if (windowEnd === null || cursor >= windowEnd) {
            windowEnd = cursor + SECONDS_PER_DAY;
            windowWorked = 0;
          }
        } else {
          const day = ymdInTimeZone(cursor, settings.timeZone);
          if (day !== calendarDay) {
            calendarDay = day;
            windowWorked = 0;
          }
        }

        const currentWeekStart = startOfWorkweekSeconds(
          cursor,
          settings.timeZone,
          settings.workweekStartDow,
          settings.workweekStartTime,
        );
        if (currentWeekStart !== weekStart) {
          weekStart = currentWeekStart;
          weekNonDaily = 0;
        }

        const next = nextSplit(cursor, piece.end, settings, windowEnd);
        const duration = next - cursor;
        if (duration <= 0) break;

        const remainingDaily = Math.max(0, dailyLimit - windowWorked);
        const dailyOtSeconds = Math.max(0, duration - remainingDaily);
        const nonDaily = duration - dailyOtSeconds;
        windowWorked += duration;

        const remainingWeekly = Math.max(0, weeklyLimit - weekNonDaily);
        const regularSeconds = Math.min(nonDaily, remainingWeekly);
        const weeklyOtSeconds = nonDaily - regularSeconds;
        weekNonDaily += nonDaily;

        const payable = cursor >= periodStart && cursor < periodEnd;
        const workweekId = ymdInTimeZone(weekStart, settings.timeZone);
        const alloc: ShiftAllocation = {
          shiftId: piece.shift.id,
          workweekId,
          regularSeconds: 0,
          dailyOtSeconds: 0,
          weeklyOtSeconds: 0,
          payable,
        };
        const aKey = allocationKey(alloc);
        const existingAlloc = allocations.get(aKey) ?? alloc;
        addSeconds(existingAlloc, regularSeconds, dailyOtSeconds, weeklyOtSeconds);
        allocations.set(aKey, existingAlloc);

        const bucket: HoursBucket = {
          employeeId: piece.shift.employeeId,
          workweekId,
          positionKey: piece.shift.positionKey,
          classId: piece.shift.classId,
          regularSeconds: 0,
          dailyOtSeconds: 0,
          weeklyOtSeconds: 0,
        };
        const buckets = payable ? payableBuckets : lookbackBuckets;
        const existingBucket = buckets.get(bucketKey(bucket)) ?? bucket;
        addSeconds(existingBucket, regularSeconds, dailyOtSeconds, weeklyOtSeconds);
        buckets.set(bucketKey(bucket), existingBucket);

        cursor = next;
      }
    }
  }

  const sortAlloc = (a: ShiftAllocation, b: ShiftAllocation) =>
    a.shiftId.localeCompare(b.shiftId) ||
    a.workweekId.localeCompare(b.workweekId) ||
    Number(b.payable) - Number(a.payable);
  const sortBucket = (a: HoursBucket, b: HoursBucket) =>
    a.employeeId.localeCompare(b.employeeId) ||
    a.workweekId.localeCompare(b.workweekId) ||
    a.positionKey.localeCompare(b.positionKey) ||
    a.classId.localeCompare(b.classId);

  return {
    allocations: [...allocations.values()].sort(sortAlloc),
    payableBuckets: [...payableBuckets.values()].sort(sortBucket),
    lookbackBuckets: [...lookbackBuckets.values()].sort(sortBucket),
    warnings,
    errors,
  };
}
