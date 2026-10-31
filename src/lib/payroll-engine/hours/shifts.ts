import { instantSeconds } from "./time";
import type { ShiftBreak, TimeBreakRow, TimeEntryRow, WorkedShift } from "./types";

export type Interval = {
  start: number;
  end: number;
};

export type ShiftsResult = {
  shifts: WorkedShift[];
  warnings: string[];
  errors: string[];
};

function parseIsoSeconds(label: string, iso: string, errors: string[]): number | null {
  const seconds = instantSeconds(iso);
  if (seconds === null) {
    errors.push(`${label} is not a valid timestamp`);
    return null;
  }
  return seconds;
}

function rangesOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function workedIntervals(shift: WorkedShift): Interval[] {
  const start = instantSeconds(shift.startedAt);
  const end = instantSeconds(shift.endedAt);
  if (start === null || end === null || end < start) return [];
  const unpaid = shift.breaks
    .filter((row) => !row.paid)
    .map((row) => {
      const breakStart = instantSeconds(row.startedAt);
      const breakEnd = instantSeconds(row.endedAt);
      if (breakStart === null || breakEnd === null) return null;
      return { start: breakStart, end: breakEnd };
    })
    .filter((row): row is Interval => row !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const intervals: Interval[] = [];
  let cursor = start;
  for (const unpaidBreak of unpaid) {
    if (unpaidBreak.start > cursor) {
      intervals.push({ start: cursor, end: unpaidBreak.start });
    }
    cursor = Math.max(cursor, unpaidBreak.end);
  }
  if (end > cursor) {
    intervals.push({ start: cursor, end });
  }
  return intervals;
}

export function validateShift(shift: WorkedShift, errors: string[]): boolean {
  const start = parseIsoSeconds(`Shift ${shift.id} start`, shift.startedAt, errors);
  const end = parseIsoSeconds(`Shift ${shift.id} end`, shift.endedAt, errors);
  if (start === null || end === null) return false;
  if (end < start) {
    errors.push(`Shift ${shift.id} ends before it starts`);
    return false;
  }
  if (!shift.employeeId) {
    errors.push(`Shift ${shift.id} is missing employeeId`);
    return false;
  }
  if (!shift.positionKey) {
    errors.push(`Shift ${shift.id} is missing positionKey`);
    return false;
  }
  if (!shift.classId) {
    errors.push(`Shift ${shift.id} is missing classId`);
    return false;
  }

  const breakIntervals: Interval[] = [];
  for (const row of shift.breaks) {
    const breakStart = parseIsoSeconds(`Shift ${shift.id} break start`, row.startedAt, errors);
    const breakEnd = parseIsoSeconds(`Shift ${shift.id} break end`, row.endedAt, errors);
    if (breakStart === null || breakEnd === null) return false;
    if (breakEnd < breakStart) {
      errors.push(`Shift ${shift.id} has a break that ends before it starts`);
      return false;
    }
    if (breakStart < start || breakEnd > end) {
      errors.push(`Shift ${shift.id} has a break outside the shift`);
      return false;
    }
    const interval = { start: breakStart, end: breakEnd };
    if (breakIntervals.some((existing) => rangesOverlap(existing, interval))) {
      errors.push(`Shift ${shift.id} has overlapping breaks`);
      return false;
    }
    breakIntervals.push(interval);
  }
  return true;
}

export function collectOverlapErrors(shifts: readonly WorkedShift[], errors: string[]): void {
  const byEmployee = new Map<string, WorkedShift[]>();
  for (const shift of shifts) {
    const list = byEmployee.get(shift.employeeId) ?? [];
    list.push(shift);
    byEmployee.set(shift.employeeId, list);
  }
  for (const [employeeId, list] of byEmployee) {
    const timed = list
      .map((shift) => {
        const start = instantSeconds(shift.startedAt);
        const end = instantSeconds(shift.endedAt);
        if (start === null || end === null) return null;
        return { shift, start, end };
      })
      .filter((row): row is { shift: WorkedShift; start: number; end: number } => row !== null)
      .sort((a, b) => a.start - b.start || a.end - b.end || a.shift.id.localeCompare(b.shift.id));

    for (let i = 0; i < timed.length; i += 1) {
      const current = timed[i];
      if (!current) continue;
      for (let j = i + 1; j < timed.length; j += 1) {
        const next = timed[j];
        if (!next) continue;
        if (next.start >= current.end) break;
        if (rangesOverlap(current, next)) {
          errors.push(
            `Employee ${employeeId} has overlapping shifts ${current.shift.id} and ${next.shift.id}`,
          );
        }
      }
    }
  }
}

export function shiftsFromTimeEntries(entries: readonly TimeEntryRow[], breaks: readonly TimeBreakRow[]): ShiftsResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const breaksByEntry = new Map<string, ShiftBreak[]>();
  for (const row of breaks) {
    const list = breaksByEntry.get(row.time_entry_id) ?? [];
    list.push({
      startedAt: row.started_at,
      endedAt: row.ended_at,
      type: row.break_type,
      paid: row.paid,
    });
    breaksByEntry.set(row.time_entry_id, list);
  }

  const seenIds = new Set<string>();
  const shifts: WorkedShift[] = [];
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      errors.push(`Duplicate time entry ${entry.id}`);
      continue;
    }
    seenIds.add(entry.id);
    if (!entry.restaurant_id) {
      errors.push(`Time entry ${entry.id} is missing restaurant_id`);
      continue;
    }
    const shift: WorkedShift = {
      id: entry.id,
      employeeId: entry.employee_id,
      positionKey: entry.position,
      classId: entry.restaurant_id,
      startedAt: entry.started_at,
      endedAt: entry.ended_at,
      breaks: breaksByEntry.get(entry.id) ?? [],
      source: "time_clock",
    };
    if (!validateShift(shift, errors)) continue;
    shifts.push(shift);
  }
  collectOverlapErrors(shifts, errors);
  return { shifts, warnings, errors };
}
