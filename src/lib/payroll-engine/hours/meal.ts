import { instantSeconds } from "./time";
import type { MealBreakFlag, MealBreakRules, WorkedShift } from "./types";

// Values are unconfirmed pending CPA review of PR meal-break timing.
export const UNCONFIRMED_MEAL_BREAK_RULES: MealBreakRules = {
  mealMinSeconds: 30 * 60,
  mealStartByWorkedSeconds: 5 * 3600,
  waiveIfShiftAtMostSeconds: null,
};

function qualifyingMeal(shift: WorkedShift, rules: MealBreakRules): { startedAt: number; duration: number } | null {
  let best: { startedAt: number; duration: number } | null = null;
  for (const row of shift.breaks) {
    const start = instantSeconds(row.startedAt);
    const end = instantSeconds(row.endedAt);
    if (start === null || end === null || end < start) continue;
    const duration = end - start;
    const counts = (row.type === "meal" || !row.paid) && duration >= rules.mealMinSeconds;
    if (!counts) continue;
    if (!best || start < best.startedAt) best = { startedAt: start, duration };
  }
  return best;
}

function workedSecondsAt(shift: WorkedShift, atSeconds: number): number {
  const start = instantSeconds(shift.startedAt);
  if (start === null) return 0;
  const unpaid = shift.breaks
    .filter((row) => !row.paid)
    .map((row) => ({ start: instantSeconds(row.startedAt), end: instantSeconds(row.endedAt) }))
    .filter((row): row is { start: number; end: number } => row.start !== null && row.end !== null)
    .sort((a, b) => a.start - b.start);

  let worked = 0;
  let cursor = start;
  const limit = Math.max(start, atSeconds);
  for (const unpaidBreak of unpaid) {
    if (unpaidBreak.start >= limit) break;
    if (unpaidBreak.start > cursor) {
      worked += Math.min(limit, unpaidBreak.start) - cursor;
    }
    cursor = Math.max(cursor, unpaidBreak.end);
  }
  if (limit > cursor) worked += limit - cursor;
  return worked;
}

function workedLength(shift: WorkedShift): number {
  const end = instantSeconds(shift.endedAt);
  if (end === null) return 0;
  return workedSecondsAt(shift, end);
}

export function mealBreakFlags(
  shifts: readonly WorkedShift[],
  rules: MealBreakRules = UNCONFIRMED_MEAL_BREAK_RULES,
): { flags: MealBreakFlag[]; warnings: string[]; errors: string[] } {
  const flags: MealBreakFlag[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const shift of shifts) {
    const start = instantSeconds(shift.startedAt);
    const end = instantSeconds(shift.endedAt);
    if (start === null || end === null || end < start) {
      errors.push(`Shift ${shift.id} has invalid times for meal-break checks`);
      continue;
    }

    for (const row of shift.breaks) {
      if (row.type !== "meal") continue;
      const breakStart = instantSeconds(row.startedAt);
      const breakEnd = instantSeconds(row.endedAt);
      if (breakStart === null || breakEnd === null) continue;
      const duration = breakEnd - breakStart;
      if (duration < rules.mealMinSeconds) {
        flags.push({
          shiftId: shift.id,
          employeeId: shift.employeeId,
          code: "meal_too_short",
          atWorkedSeconds: workedSecondsAt(shift, breakStart),
        });
      }
    }

    const worked = workedLength(shift);
    if (rules.waiveIfShiftAtMostSeconds !== null && worked <= rules.waiveIfShiftAtMostSeconds) {
      continue;
    }
    if (worked <= rules.mealStartByWorkedSeconds) continue;

    const meal = qualifyingMeal(shift, rules);
    const mealWorkedStart = meal ? workedSecondsAt(shift, meal.startedAt) : Number.POSITIVE_INFINITY;
    if (mealWorkedStart > rules.mealStartByWorkedSeconds) {
      flags.push({
        shiftId: shift.id,
        employeeId: shift.employeeId,
        code: "meal_not_started_by_5h",
        atWorkedSeconds: rules.mealStartByWorkedSeconds,
      });
    }
  }

  return { flags, warnings, errors };
}
