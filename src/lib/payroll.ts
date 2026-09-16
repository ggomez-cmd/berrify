import { startOfWorkweek } from "./time-clock";

export const WEEKLY_OT_THRESHOLD_SECONDS = 40 * 3600;
export const OT_MULTIPLIER = 1.5;
export const WORKWEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type PayrollPunch = {
  employee_id: string;
  restaurant_id: string | null;
  started_at: string;
  worked_seconds: number;
};

export type PayrollEmployee = {
  id: string;
  full_name: string;
  hourly_rate: number;
};

export type WorkweekPeriod = {
  start: Date;
  end: Date;
  inProgress: boolean;
};

export type PayrollLine = {
  employee_id: string;
  full_name: string;
  regular_seconds: number;
  ot_seconds: number;
  hourly_rate: number;
  gross: number;
};

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function hoursFromSeconds(seconds: number): number {
  return roundMoney(Math.max(0, Math.floor(Number(seconds) || 0)) / 3600);
}

export function splitWeeklyOvertime(workedSeconds: number): {
  regular_seconds: number;
  ot_seconds: number;
} {
  const total = Math.max(0, Math.floor(Number(workedSeconds) || 0));
  const ot_seconds = Math.max(0, total - WEEKLY_OT_THRESHOLD_SECONDS);
  return { regular_seconds: total - ot_seconds, ot_seconds };
}

export function payrollGross(regularSeconds: number, otSeconds: number, hourlyRate: number): number {
  const rate = Number(hourlyRate) || 0;
  return roundMoney((regularSeconds / 3600) * rate + (otSeconds / 3600) * rate * OT_MULTIPLIER);
}

export function punchInPeriod(
  punch: PayrollPunch,
  restaurantId: string,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (punch.restaurant_id !== restaurantId) return false;
  const at = new Date(punch.started_at).getTime();
  return at >= periodStart.getTime() && at < periodEnd.getTime();
}

export function lastCompletedWorkweek(
  instant: Date,
  timeZone: string,
  startDow: number,
  startTime: string,
): WorkweekPeriod {
  const currentStart = startOfWorkweek(instant, timeZone, startDow, startTime);
  return {
    start: new Date(currentStart.getTime() - WORKWEEK_MS),
    end: currentStart,
    inProgress: false,
  };
}

export function listPayrollWorkweeks(
  instant: Date,
  timeZone: string,
  startDow: number,
  startTime: string,
  pastCount = 8,
): WorkweekPeriod[] {
  const currentStart = startOfWorkweek(instant, timeZone, startDow, startTime);
  const current: WorkweekPeriod = {
    start: currentStart,
    end: new Date(currentStart.getTime() + WORKWEEK_MS),
    inProgress: true,
  };
  const completed: WorkweekPeriod[] = [];
  for (let i = 1; i <= pastCount; i += 1) {
    const start = new Date(currentStart.getTime() - i * WORKWEEK_MS);
    completed.push({
      start,
      end: new Date(start.getTime() + WORKWEEK_MS),
      inProgress: false,
    });
  }
  const latestCompleted = completed[0];
  if (!latestCompleted) return [current];
  return [latestCompleted, current, ...completed.slice(1)];
}

export function ymdInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function formatWorkweekLabel(period: WorkweekPeriod, timeZone: string): string {
  const startLabel = period.start.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endInclusive = new Date(period.end.getTime() - 1);
  const endLabel = endInclusive.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const suffix = period.inProgress ? " (in progress)" : "";
  return `${startLabel} – ${endLabel}${suffix}`;
}

export function periodKey(period: WorkweekPeriod): string {
  return `${period.start.toISOString()}|${period.end.toISOString()}`;
}

export function parsePeriodKey(key: string): { start: Date; end: Date } | null {
  const [startText, endText] = key.split("|");
  if (!startText || !endText) return null;
  const start = new Date(startText);
  const end = new Date(endText);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return { start, end };
}

export function buildPayrollLines(input: {
  punches: PayrollPunch[];
  employees: PayrollEmployee[];
  restaurantId: string;
  periodStart: Date;
  periodEnd: Date;
}): PayrollLine[] {
  const byEmployee = new Map<string, number>();
  for (const punch of input.punches) {
    if (!punchInPeriod(punch, input.restaurantId, input.periodStart, input.periodEnd)) continue;
    const worked = Math.max(0, Math.floor(Number(punch.worked_seconds) || 0));
    byEmployee.set(punch.employee_id, (byEmployee.get(punch.employee_id) ?? 0) + worked);
  }

  const employees = new Map(input.employees.map((row) => [row.id, row]));
  const lines: PayrollLine[] = [];
  for (const [employeeId, workedSeconds] of byEmployee) {
    const employee = employees.get(employeeId);
    const split = splitWeeklyOvertime(workedSeconds);
    const hourly_rate = Number(employee?.hourly_rate) || 0;
    lines.push({
      employee_id: employeeId,
      full_name: employee?.full_name ?? "Unknown",
      regular_seconds: split.regular_seconds,
      ot_seconds: split.ot_seconds,
      hourly_rate,
      gross: payrollGross(split.regular_seconds, split.ot_seconds, hourly_rate),
    });
  }

  return lines.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.employee_id.localeCompare(b.employee_id));
}

export function countOpenPayrollIssues(input: {
  periodEntryIds: Set<string>;
  periodEmployeeIds: Set<string>;
  periodStart: Date;
  periodEnd: Date;
  exceptions: Array<{
    status: string;
    employee_id: string;
    time_entry_id: string | null;
    created_at: string;
  }>;
  sessions: Array<{
    employee_id: string;
    restaurant_id: string | null;
    clocked_in_at: string;
  }>;
  restaurantId: string;
}): { openExceptions: number; openSessions: number } {
  const startMs = input.periodStart.getTime();
  const endMs = input.periodEnd.getTime();
  let openExceptions = 0;
  for (const row of input.exceptions) {
    if (row.status !== "open") continue;
    if (row.time_entry_id && input.periodEntryIds.has(row.time_entry_id)) {
      openExceptions += 1;
      continue;
    }
    const created = new Date(row.created_at).getTime();
    if (
      !row.time_entry_id &&
      created >= startMs &&
      created < endMs &&
      input.periodEmployeeIds.has(row.employee_id)
    ) {
      openExceptions += 1;
    }
  }

  let openSessions = 0;
  for (const session of input.sessions) {
    if (session.restaurant_id !== input.restaurantId) continue;
    const clockedIn = new Date(session.clocked_in_at).getTime();
    if (clockedIn < endMs) openSessions += 1;
  }

  return { openExceptions, openSessions };
}
