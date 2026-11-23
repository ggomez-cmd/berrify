import { localMidnightSeconds } from "./payroll-engine/hours/time";

// Read-only view of an employee's completed shifts (time_entries).

export type CompletedShift = {
  started_at: string;
  worked_seconds: number;
};

/** "7 h 30 min", "45 min", "0 min". */
export function formatWorked(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function summarizeShifts(shifts: CompletedShift[]): { count: number; workedSeconds: number } {
  return {
    count: shifts.length,
    workedSeconds: shifts.reduce((sum, s) => sum + s.worked_seconds, 0),
  };
}

function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The pager's calendar week (a local date) as exact instants in the
 * organization's time zone, so a shift lands in the same week whatever time
 * zone the phone is set to.
 */
export function weekRangeInZone(weekStartDay: Date, timeZone: string): { from: Date; to: Date } {
  const end = new Date(weekStartDay);
  end.setDate(end.getDate() + 7);
  return {
    from: new Date(localMidnightSeconds(ymd(weekStartDay), timeZone) * 1000),
    to: new Date(localMidnightSeconds(ymd(end), timeZone) * 1000),
  };
}
