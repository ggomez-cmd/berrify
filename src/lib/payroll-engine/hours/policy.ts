import { roundHalfUpDiv } from "../money";
import { workedIntervals } from "./shifts";
import { instantSeconds, isoFromSeconds, ymdInTimeZone } from "./time";
import type { HoursPolicy, HoursPolicyResult, LunchDeduction, ShiftBreak, WorkedShift } from "./types";

export const HUNDREDTH_HOUR_SECONDS = 36;
// Clover's own paid hours win when they are within 0.02 h of the punch times, as on the payroll worksheet.
const REPORTED_TOLERANCE_SECONDS = 2 * HUNDREDTH_HOUR_SECONDS;
const MIN_SHIFT_FOR_BREAK_SECONDS = 6 * 60;

function cloneShift(shift: WorkedShift): WorkedShift {
  return { ...shift, breaks: shift.breaks.map((row) => ({ ...row })) };
}

function workedSecondsOf(shift: WorkedShift): number {
  return workedIntervals(shift).reduce((sum, interval) => sum + interval.end - interval.start, 0);
}

export function roundSecondsToHundredthHour(seconds: number): number {
  if (seconds <= 0) return 0;
  return Number(roundHalfUpDiv(BigInt(seconds), BigInt(HUNDREDTH_HOUR_SECONDS))) * HUNDREDTH_HOUR_SECONDS;
}

function clampIso(iso: string, minSeconds: number, maxSeconds: number): string {
  const seconds = instantSeconds(iso);
  if (seconds === null) return iso;
  return isoFromSeconds(Math.min(maxSeconds, Math.max(minSeconds, seconds)));
}

function applyPunchRounding(shift: WorkedShift): WorkedShift {
  const start = instantSeconds(shift.startedAt);
  const end = instantSeconds(shift.endedAt);
  if (start === null || end === null || end < start) return shift;
  const worked = workedSecondsOf(shift);
  const reported = shift.reportedWorkedSeconds;
  const rounded =
    reported !== undefined && Math.abs(reported - worked) <= REPORTED_TOLERANCE_SECONDS
      ? roundSecondsToHundredthHour(reported)
      : roundSecondsToHundredthHour(worked);
  const delta = rounded - worked;
  if (delta === 0) return shift;
  const nextEnd = end + delta;
  const next: WorkedShift = {
    ...shift,
    endedAt: isoFromSeconds(nextEnd),
    breaks: shift.breaks,
  };
  if (nextEnd >= end) return next;
  next.breaks = shift.breaks
    .map((row) => {
      const breakStart = instantSeconds(row.startedAt);
      const breakEnd = instantSeconds(row.endedAt);
      if (breakStart === null || breakEnd === null) return row;
      const clampedStart = Math.min(Math.max(breakStart, start), nextEnd);
      const clampedEnd = Math.min(Math.max(breakEnd, start), nextEnd);
      if (clampedEnd <= clampedStart) return null;
      return {
        ...row,
        startedAt: clampIso(row.startedAt, start, nextEnd),
        endedAt: clampIso(row.endedAt, start, nextEnd),
      };
    })
    .filter((row): row is ShiftBreak => row !== null);
  return next;
}

function deductFromShift(shift: WorkedShift, seconds: number): { shift: WorkedShift; remaining: number } {
  if (seconds <= 0) return { shift, remaining: 0 };
  const intervals = workedIntervals(shift);
  if (intervals.length === 0) return { shift, remaining: seconds };
  const added: ShiftBreak[] = [];
  let remaining = seconds;
  for (let index = intervals.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const interval = intervals[index];
    if (!interval) continue;
    const take = Math.min(remaining, interval.end - interval.start);
    if (take <= 0) continue;
    added.push({
      startedAt: isoFromSeconds(interval.end - take),
      endedAt: isoFromSeconds(interval.end),
      type: "meal",
      paid: false,
    });
    remaining -= take;
  }
  if (added.length === 0) return { shift, remaining };
  return { shift: { ...shift, breaks: [...shift.breaks, ...added.reverse()] }, remaining };
}

function dayKey(employeeId: string, classId: string, ymd: string): string {
  return `${employeeId}\t${classId}\t${ymd}`;
}

function applyMealDeduction(
  shifts: readonly WorkedShift[],
  policy: NonNullable<HoursPolicy["mealDeduction"]>,
  timeZone: string,
  lunchDeductions: LunchDeduction[],
  errors: string[],
): WorkedShift[] {
  if (!Number.isSafeInteger(policy.afterSeconds) || policy.afterSeconds < 0) {
    errors.push("mealDeduction.afterSeconds must be a non-negative integer");
    return [...shifts];
  }
  if (!Number.isSafeInteger(policy.deductSeconds) || policy.deductSeconds < 0) {
    errors.push("mealDeduction.deductSeconds must be a non-negative integer");
    return [...shifts];
  }

  const byDay = new Map<string, WorkedShift[]>();
  const order: string[] = [];
  for (const shift of shifts) {
    const started = instantSeconds(shift.startedAt);
    if (started === null) {
      const key = dayKey(shift.employeeId, shift.classId, "");
      const list = byDay.get(key) ?? [];
      if (!byDay.has(key)) order.push(key);
      list.push(shift);
      byDay.set(key, list);
      continue;
    }
    const ymd = ymdInTimeZone(started, timeZone);
    const key = dayKey(shift.employeeId, shift.classId, ymd);
    const list = byDay.get(key) ?? [];
    if (!byDay.has(key)) order.push(key);
    list.push(shift);
    byDay.set(key, list);
  }

  const nextById = new Map(shifts.map((shift) => [shift.id, shift]));
  for (const key of order) {
    const group = byDay.get(key);
    if (!group || group.length === 0) continue;
    const [employeeId, , ymd] = key.split("\t");
    if (!employeeId || !ymd) continue;

    const dayWorked = group.reduce((sum, shift) => sum + workedSecondsOf(shift), 0);
    if (dayWorked <= policy.afterSeconds) continue;

    const qualifying = group.filter((shift) => workedSecondsOf(shift) >= MIN_SHIFT_FOR_BREAK_SECONDS);
    let breakTaken = 0;
    if (qualifying.length > 0) {
      let earliest = Number.POSITIVE_INFINITY;
      let latest = Number.NEGATIVE_INFINITY;
      let qualifiedWorked = 0;
      for (const shift of qualifying) {
        const start = instantSeconds(shift.startedAt);
        const end = instantSeconds(shift.endedAt);
        if (start === null || end === null) continue;
        earliest = Math.min(earliest, start);
        latest = Math.max(latest, end);
        qualifiedWorked += workedSecondsOf(shift);
      }
      if (Number.isFinite(earliest) && Number.isFinite(latest)) {
        breakTaken = Math.max(0, latest - earliest - qualifiedWorked);
      }
    }

    const deduction = roundSecondsToHundredthHour(Math.max(0, policy.deductSeconds - breakTaken));
    if (deduction <= 0) continue;

    const chronological = [...group].sort((a, b) => {
      const aEnd = instantSeconds(a.endedAt) ?? 0;
      const bEnd = instantSeconds(b.endedAt) ?? 0;
      if (aEnd !== bEnd) return aEnd - bEnd;
      const aStart = instantSeconds(a.startedAt) ?? 0;
      const bStart = instantSeconds(b.startedAt) ?? 0;
      return aStart - bStart || a.id.localeCompare(b.id);
    });

    let remaining = deduction;
    for (let index = chronological.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const current = chronological[index];
      if (!current) continue;
      const applied = deductFromShift(current, remaining);
      chronological[index] = applied.shift;
      nextById.set(applied.shift.id, applied.shift);
      remaining = applied.remaining;
    }

    lunchDeductions.push({ employeeId, ymd, seconds: deduction - remaining });
  }

  return shifts.map((shift) => nextById.get(shift.id) ?? shift);
}

export function applyHoursPolicy(shifts: readonly WorkedShift[], policy: HoursPolicy): HoursPolicyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lunchDeductions: LunchDeduction[] = [];
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: policy.timeZone }).format(new Date());
  } catch {
    return { shifts: shifts.map(cloneShift), lunchDeductions, warnings, errors: [`Unknown time zone ${policy.timeZone}`] };
  }

  const rounding = policy.punchRounding ?? "none";
  if (rounding !== "none" && rounding !== "hundredth_hour") {
    const exhaustive: never = rounding;
    return { shifts: shifts.map(cloneShift), lunchDeductions, warnings, errors: [`Unhandled punch rounding: ${exhaustive}`] };
  }

  let next = shifts.map(cloneShift);
  if (rounding === "hundredth_hour") {
    next = next.map(applyPunchRounding);
  }
  if (policy.mealDeduction) {
    next = applyMealDeduction(next, policy.mealDeduction, policy.timeZone, lunchDeductions, errors);
  }
  return { shifts: next, lunchDeductions, warnings, errors };
}
