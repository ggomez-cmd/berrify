import { addCalendarDays, isYmd } from "../payroll-engine/hours/time";
import type { PayFrequency } from "../payroll-engine/types";
import type { PayrollPayScheduleRow } from "../types";

export type PayPeriod = {
  periodStart: string;
  periodEnd: string;
  checkDate: string;
};

export type PayScheduleInput = Pick<
  PayrollPayScheduleRow,
  "frequency" | "anchor_period_start" | "check_lag_days"
>;

function asYmd(value: string): string {
  return value.slice(0, 10);
}

function periodLengthDays(frequency: PayFrequency): number {
  switch (frequency) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    default: {
      const exhaustive: never = frequency;
      throw new Error(`Unhandled pay frequency: ${exhaustive}`);
    }
  }
}

function utcDaysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.UTC(Number(fromYmd.slice(0, 4)), Number(fromYmd.slice(5, 7)) - 1, Number(fromYmd.slice(8, 10)));
  const to = Date.UTC(Number(toYmd.slice(0, 4)), Number(toYmd.slice(5, 7)) - 1, Number(toYmd.slice(8, 10)));
  return Math.trunc((to - from) / 86_400_000);
}

export function periodContaining(schedule: PayScheduleInput, date: string): PayPeriod {
  const onDate = asYmd(date);
  const anchor = asYmd(schedule.anchor_period_start);
  if (!isYmd(onDate) || !isYmd(anchor)) {
    throw new Error("Pay schedule dates must be YYYY-MM-DD");
  }
  const length = periodLengthDays(schedule.frequency);
  const offset = utcDaysBetween(anchor, onDate);
  const n = Math.floor(offset / length);
  const periodStart = addCalendarDays(anchor, n * length);
  const periodEnd = addCalendarDays(periodStart, length - 1);
  return {
    periodStart,
    periodEnd,
    checkDate: addCalendarDays(periodEnd, schedule.check_lag_days),
  };
}

export function nextPeriod(schedule: PayScheduleInput, date: string): PayPeriod {
  const current = periodContaining(schedule, date);
  const length = periodLengthDays(schedule.frequency);
  const periodStart = addCalendarDays(current.periodStart, length);
  const periodEnd = addCalendarDays(periodStart, length - 1);
  return {
    periodStart,
    periodEnd,
    checkDate: addCalendarDays(periodEnd, schedule.check_lag_days),
  };
}

// The most recent period that has fully ended before `date`: the one a new run usually pays.
export function lastEndedPeriod(schedule: PayScheduleInput, date: string): PayPeriod {
  const current = periodContaining(schedule, date);
  return periodContaining(schedule, addCalendarDays(current.periodStart, -1));
}

export function scheduleForRestaurant(
  schedules: readonly PayrollPayScheduleRow[],
  restaurantId: string,
): PayrollPayScheduleRow | null {
  return schedules.find((row) => row.restaurant_id === restaurantId) ?? null;
}
