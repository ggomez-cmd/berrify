import type { HourlyWeekInput } from "../types";
import { addCalendarDays, instantSeconds, isYmd, secondsToHoursHundredths, ymdInTimeZone } from "./time";
import type { HourlyWeeksResult, PositionRate, ShiftAllocation, WeekTips, WorkedShift } from "./types";

function shiftById(shifts: readonly WorkedShift[]): Map<string, WorkedShift> {
  const map = new Map<string, WorkedShift>();
  for (const shift of shifts) map.set(shift.id, shift);
  return map;
}

function rateFor(
  rates: readonly PositionRate[],
  employeeId: string,
  positionKey: string,
  localYmd: string,
): PositionRate | null {
  let best: PositionRate | null = null;
  for (const rate of rates) {
    if (rate.employeeId !== employeeId || rate.positionKey !== positionKey) continue;
    if (!isYmd(rate.effectiveFrom) || rate.effectiveFrom > localYmd) continue;
    if (
      !best ||
      rate.effectiveFrom > best.effectiveFrom ||
      (rate.effectiveFrom === best.effectiveFrom && rate.rateCents > best.rateCents)
    ) {
      best = rate;
    }
  }
  return best;
}

function latestRateInWeek(
  rates: readonly PositionRate[],
  employeeId: string,
  workweekId: string,
): PositionRate | null {
  if (!isYmd(workweekId)) return null;
  const weekEnd = addCalendarDays(workweekId, 6);
  let best: PositionRate | null = null;
  for (const rate of rates) {
    if (rate.employeeId !== employeeId) continue;
    if (!isYmd(rate.effectiveFrom) || rate.effectiveFrom > weekEnd) continue;
    if (
      !best ||
      rate.effectiveFrom > best.effectiveFrom ||
      (rate.effectiveFrom === best.effectiveFrom && rate.rateCents > best.rateCents)
    ) {
      best = rate;
    }
  }
  return best;
}

type RatedBucket = {
  employeeId: string;
  workweekId: string;
  positionKey: string;
  classId: string;
  rateCents: number;
  regularSeconds: number;
  dailyOtSeconds: number;
  weeklyOtSeconds: number;
  tipsCents: number;
};

function ratedKey(row: RatedBucket): string {
  return `${row.employeeId}\t${row.workweekId}\t${row.positionKey}\t${row.classId}\t${row.rateCents}`;
}

export function buildHourlyWeeks(input: {
  shifts: readonly WorkedShift[];
  allocations: readonly ShiftAllocation[];
  rates: readonly PositionRate[];
  tips?: readonly WeekTips[];
  timeZone: string;
}): HourlyWeeksResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shifts = shiftById(input.shifts);
  const buckets = new Map<string, RatedBucket>();
  const missingRateShifts = new Set<string>();

  for (const allocation of input.allocations) {
    if (!allocation.payable) continue;
    const shift = shifts.get(allocation.shiftId);
    if (!shift) {
      errors.push(`Allocation refers to unknown shift ${allocation.shiftId}`);
      continue;
    }
    const started = instantSeconds(shift.startedAt);
    if (started === null) {
      errors.push(`Shift ${shift.id} has an invalid start`);
      continue;
    }
    const localYmd = ymdInTimeZone(started, input.timeZone);
    const rate = rateFor(input.rates, shift.employeeId, shift.positionKey, localYmd);
    if (!rate) {
      if (!missingRateShifts.has(shift.id)) {
        errors.push(
          `Shift ${shift.id} has no rate for employee ${shift.employeeId} position ${shift.positionKey} on ${localYmd}`,
        );
        missingRateShifts.add(shift.id);
      }
      continue;
    }
    const bucket: RatedBucket = {
      employeeId: shift.employeeId,
      workweekId: allocation.workweekId,
      positionKey: shift.positionKey,
      classId: shift.classId,
      rateCents: rate.rateCents,
      regularSeconds: 0,
      dailyOtSeconds: 0,
      weeklyOtSeconds: 0,
      tipsCents: 0,
    };
    const key = ratedKey(bucket);
    const existing = buckets.get(key) ?? bucket;
    existing.regularSeconds += allocation.regularSeconds;
    existing.dailyOtSeconds += allocation.dailyOtSeconds;
    existing.weeklyOtSeconds += allocation.weeklyOtSeconds;
    buckets.set(key, existing);
  }

  for (const tip of input.tips ?? []) {
    if (tip.tipsCents < 0) {
      errors.push(`Employee ${tip.employeeId} has negative tips on workweek ${tip.workweekId}`);
      continue;
    }
    if (!isYmd(tip.workweekId)) {
      errors.push(`Employee ${tip.employeeId} has an unknown workweek ${tip.workweekId}`);
      continue;
    }
    const employeeBuckets = [...buckets.values()]
      .filter((row) => row.employeeId === tip.employeeId && row.workweekId === tip.workweekId)
      .sort(
        (a, b) =>
          a.positionKey.localeCompare(b.positionKey) ||
          a.classId.localeCompare(b.classId) ||
          a.rateCents - b.rateCents,
      );
    const first = employeeBuckets[0];
    if (first) {
      first.tipsCents += tip.tipsCents;
      continue;
    }
    const rate = latestRateInWeek(input.rates, tip.employeeId, tip.workweekId);
    if (!rate) {
      errors.push(`Employee ${tip.employeeId} has tips on ${tip.workweekId} but no rate`);
      continue;
    }
    const created: RatedBucket = {
      employeeId: tip.employeeId,
      workweekId: tip.workweekId,
      positionKey: rate.positionKey,
      classId: "",
      rateCents: rate.rateCents,
      regularSeconds: 0,
      dailyOtSeconds: 0,
      weeklyOtSeconds: 0,
      tipsCents: tip.tipsCents,
    };
    buckets.set(ratedKey(created), created);
  }

  const weeks = new Map<string, HourlyWeekInput[]>();
  const sorted = [...buckets.values()].sort(
    (a, b) =>
      a.employeeId.localeCompare(b.employeeId) ||
      a.workweekId.localeCompare(b.workweekId) ||
      a.positionKey.localeCompare(b.positionKey) ||
      a.classId.localeCompare(b.classId) ||
      a.rateCents - b.rateCents,
  );
  for (const bucket of sorted) {
    const row: HourlyWeekInput = {
      workweekId: bucket.workweekId,
      classId: bucket.classId || null,
      positionId: bucket.positionKey,
      rateCents: bucket.rateCents,
      regularHoursHundredths: secondsToHoursHundredths(bucket.regularSeconds),
      dailyOtHoursHundredths: secondsToHoursHundredths(bucket.dailyOtSeconds),
      weeklyOtHoursHundredths: secondsToHoursHundredths(bucket.weeklyOtSeconds),
      tipsCents: bucket.tipsCents,
    };
    const list = weeks.get(bucket.employeeId) ?? [];
    list.push(row);
    weeks.set(bucket.employeeId, list);
  }

  return { weeks, warnings, errors };
}
