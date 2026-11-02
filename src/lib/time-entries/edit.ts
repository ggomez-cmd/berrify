import {
  addCalendarDays,
  instantSeconds,
  isHm,
  isYmd,
  pad2,
  parseHm,
  utcSecondsFromZoned,
  ymdInTimeZone,
  zonedParts,
} from "../payroll-engine/hours/time";
import type { BreakType } from "../time-clock";
import type { TimeBreak, TimeEntry, TimeEntryEdit, TimeException } from "../types";

export const TIME_ENTRY_REASON_MAX = 500;
export const TIME_ENTRY_MAX_SECONDS = 24 * 3600;

export type TimeEntryFormBreak = {
  startedAt: string;
  endedAt: string;
  breakType: BreakType;
  paid: boolean;
  originalStartedAt?: string;
  originalEndedAt?: string;
};

export type TimeEntryFormInput = {
  entryId?: string | null;
  employeeId: string;
  restaurantId: string;
  position: string;
  date: string;
  start: string;
  end: string;
  breaks: readonly TimeEntryFormBreak[];
  reason: string;
  timeZone: string;
  originalStartedAt?: string;
  originalEndedAt?: string;
};

export type TimeEntryRpcBreak = {
  started_at: string;
  ended_at: string;
  break_type: BreakType;
  paid: boolean;
};

export type TimeEntryRpcPayload = {
  target_entry_id: string | null;
  target_employee_id: string;
  target_restaurant_id: string;
  target_position: string;
  new_started_at: string;
  new_ended_at: string;
  new_breaks: TimeEntryRpcBreak[];
  reason: string;
};

export type TimeEntryFormResult =
  | { ok: true; payload: TimeEntryRpcPayload; workedSeconds: number }
  | { ok: false; error: string };

export type ApprovedTimeClockWindow = {
  period_start: string;
  period_end: string;
  check_date: string;
  time_zone: string;
  from: string;
  until: string;
};

export type ReviewShiftRow = {
  entry: TimeEntry;
  breaks: TimeBreak[];
  workedSeconds: number;
  hasOpenException: boolean;
  noRestaurant: boolean;
  edited: boolean;
  approvedCheckDate: string | null;
};

export type ReviewEmployeeGroup = {
  employeeId: string;
  name: string;
  totalWorkedSeconds: number;
  shifts: ReviewShiftRow[];
};

function isoFromUtcSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function hmInTimeZone(seconds: number, timeZone: string): string {
  const parts = zonedParts(seconds, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function localDateAndHm(iso: string, timeZone: string): { date: string; hm: string } | null {
  const seconds = instantSeconds(iso);
  if (seconds === null) return null;
  return { date: ymdInTimeZone(seconds, timeZone), hm: hmInTimeZone(seconds, timeZone) };
}

function reuseOriginalInstant(
  originalIso: string | undefined,
  displayedDate: string,
  displayedHm: string,
  timeZone: string,
): string | null {
  if (!originalIso) return null;
  const shown = localDateAndHm(originalIso, timeZone);
  if (!shown) return null;
  if (shown.date === displayedDate && shown.hm === displayedHm) return originalIso;
  return null;
}

function zonedInstant(ymd: string, hm: string, timeZone: string): number | null {
  const parsed = parseHm(hm);
  if (!isYmd(ymd) || !parsed) return null;
  try {
    return utcSecondsFromZoned({
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: parsed.hour,
      minute: parsed.minute,
      second: 0,
      timeZone,
    });
  } catch {
    return null;
  }
}

function placeClock(ymd: string, hm: string, notBefore: number | null, timeZone: string): number | null {
  const sameDay = zonedInstant(ymd, hm, timeZone);
  if (sameDay === null) return null;
  if (notBefore === null || sameDay >= notBefore) return sameDay;
  return zonedInstant(addCalendarDays(ymd, 1), hm, timeZone);
}

function resolveFormInstant(
  originalIso: string | undefined,
  formDate: string,
  hm: string,
  notBefore: number,
  timeZone: string,
): string | null {
  const sameDay = reuseOriginalInstant(originalIso, formDate, hm, timeZone);
  if (sameDay) {
    const seconds = instantSeconds(sameDay);
    if (seconds !== null && seconds >= notBefore) return sameDay;
  }
  const nextDate = addCalendarDays(formDate, 1);
  const nextDay = reuseOriginalInstant(originalIso, nextDate, hm, timeZone);
  if (nextDay) {
    const seconds = instantSeconds(nextDay);
    if (seconds !== null && seconds >= notBefore) return nextDay;
  }
  const placed = placeClock(formDate, hm, notBefore, timeZone);
  return placed === null ? null : isoFromUtcSeconds(placed);
}

export function workedSecondsFromRange(
  startedAt: string,
  endedAt: string,
  breaks: readonly { started_at: string; ended_at: string; paid: boolean }[],
): number {
  const start = instantSeconds(startedAt);
  const end = instantSeconds(endedAt);
  if (start === null || end === null || end <= start) return 0;
  let unpaid = 0;
  for (const row of breaks) {
    if (row.paid) continue;
    const breakStart = instantSeconds(row.started_at);
    const breakEnd = instantSeconds(row.ended_at);
    if (breakStart === null || breakEnd === null || breakEnd <= breakStart) continue;
    unpaid += breakEnd - breakStart;
  }
  return Math.max(0, end - start - unpaid);
}

export function formatWorkedHours(seconds: number): string {
  const hours = Math.round((seconds / 3600) * 100) / 100;
  return String(hours);
}

export function buildTimeEntryRpcPayload(input: TimeEntryFormInput): TimeEntryFormResult {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Reason is required" };
  if (reason.length > TIME_ENTRY_REASON_MAX) return { ok: false, error: "Reason must be 500 characters or fewer" };
  if (!input.employeeId) return { ok: false, error: "Employee is required" };
  if (!input.restaurantId) return { ok: false, error: "Restaurant is required" };
  const position = input.position.trim();
  if (!position) return { ok: false, error: "Position is required" };
  if (!isYmd(input.date)) return { ok: false, error: "Date must be YYYY-MM-DD" };
  if (!isHm(input.start) || !parseHm(input.start)) return { ok: false, error: "In time must be HH:MM" };
  if (!isHm(input.end) || !parseHm(input.end)) return { ok: false, error: "Out time must be HH:MM" };

  const startedRebuilt = zonedInstant(input.date, input.start, input.timeZone);
  if (startedRebuilt === null) return { ok: false, error: "In time is not a valid local time in the organization time zone" };
  const startedAt =
    reuseOriginalInstant(input.originalStartedAt, input.date, input.start, input.timeZone) ??
    isoFromUtcSeconds(startedRebuilt);
  const started = instantSeconds(startedAt);
  if (started === null) return { ok: false, error: "In time is not a valid local time in the organization time zone" };

  const endedUnchangedSameDay = reuseOriginalInstant(
    input.originalEndedAt,
    input.date,
    input.end,
    input.timeZone,
  );
  let endedAt = endedUnchangedSameDay;
  if (endedAt === null) {
    const endedSameDay = zonedInstant(input.date, input.end, input.timeZone);
    // A time skipped by a DST change is invalid, not a reason to roll to tomorrow.
    if (endedSameDay === null) {
      return { ok: false, error: "Out time is not a valid local time in the organization time zone" };
    }
    if (endedSameDay > started) {
      endedAt = isoFromUtcSeconds(endedSameDay);
    } else {
      const endedDate = addCalendarDays(input.date, 1);
      const endedNext =
        reuseOriginalInstant(input.originalEndedAt, endedDate, input.end, input.timeZone) ??
        zonedInstant(endedDate, input.end, input.timeZone);
      if (endedNext === null) {
        return { ok: false, error: "Out time is not a valid local time in the organization time zone" };
      }
      endedAt = typeof endedNext === "string" ? endedNext : isoFromUtcSeconds(endedNext);
    }
  }
  const ended = instantSeconds(endedAt);
  if (ended === null) return { ok: false, error: "Out time is not a valid local time in the organization time zone" };
  if (ended <= started) return { ok: false, error: "Out must be after in" };
  if (ended - started > TIME_ENTRY_MAX_SECONDS) return { ok: false, error: "Shift cannot exceed 24 hours" };
  if (ended > Math.floor(Date.now() / 1000) + 5 * 60) {
    return { ok: false, error: "Out cannot be more than 5 minutes in the future" };
  }

  const rpcBreaks: TimeEntryRpcBreak[] = [];
  for (const [index, row] of input.breaks.entries()) {
    const label = `Break ${index + 1}`;
    if (!isHm(row.startedAt) || !parseHm(row.startedAt)) {
      return { ok: false, error: `${label}: start must be HH:MM` };
    }
    if (!isHm(row.endedAt) || !parseHm(row.endedAt)) {
      return { ok: false, error: `${label}: end must be HH:MM` };
    }
    switch (row.breakType) {
      case "meal":
      case "rest":
      case "other":
        break;
      default: {
        const exhaustive: never = row.breakType;
        return { ok: false, error: `${label}: type is invalid (${exhaustive})` };
      }
    }
    const breakStartedAt = resolveFormInstant(
      row.originalStartedAt,
      input.date,
      row.startedAt,
      started,
      input.timeZone,
    );
    if (breakStartedAt === null) return { ok: false, error: `${label}: start is not a valid local time` };
    const breakStartSeconds = instantSeconds(breakStartedAt);
    if (breakStartSeconds === null) return { ok: false, error: `${label}: start is not a valid local time` };
    const breakEndedAt = resolveFormInstant(
      row.originalEndedAt,
      input.date,
      row.endedAt,
      breakStartSeconds + 1,
      input.timeZone,
    );
    if (breakEndedAt === null) return { ok: false, error: `${label}: end is not a valid local time` };
    const breakStart = instantSeconds(breakStartedAt);
    const breakEnd = instantSeconds(breakEndedAt);
    if (breakStart === null || breakEnd === null) return { ok: false, error: `${label}: start is not a valid local time` };
    if (breakEnd <= breakStart) return { ok: false, error: `${label}: end must be after start` };
    if (breakStart < started || breakEnd > ended) {
      return { ok: false, error: `${label}: must stay inside the shift` };
    }
    rpcBreaks.push({
      started_at: breakStartedAt,
      ended_at: breakEndedAt,
      break_type: row.breakType,
      paid: row.paid,
    });
  }

  for (let i = 0; i < rpcBreaks.length; i += 1) {
    for (let j = i + 1; j < rpcBreaks.length; j += 1) {
      const left = rpcBreaks[i];
      const right = rpcBreaks[j];
      const leftStart = instantSeconds(left.started_at);
      const leftEnd = instantSeconds(left.ended_at);
      const rightStart = instantSeconds(right.started_at);
      const rightEnd = instantSeconds(right.ended_at);
      if (
        leftStart !== null &&
        leftEnd !== null &&
        rightStart !== null &&
        rightEnd !== null &&
        leftStart < rightEnd &&
        rightStart < leftEnd
      ) {
        return { ok: false, error: "Breaks overlap" };
      }
    }
  }

  const payload: TimeEntryRpcPayload = {
    target_entry_id: input.entryId ?? null,
    target_employee_id: input.employeeId,
    target_restaurant_id: input.restaurantId,
    target_position: position,
    new_started_at: startedAt,
    new_ended_at: endedAt,
    new_breaks: rpcBreaks,
    reason,
  };

  return {
    ok: true,
    payload,
    workedSeconds: workedSecondsFromRange(payload.new_started_at, payload.new_ended_at, payload.new_breaks),
  };
}

export function approvedCheckDateForShift(
  startedAt: string,
  windows: readonly ApprovedTimeClockWindow[],
): string | null {
  const started = instantSeconds(startedAt);
  if (started === null) return null;
  for (const window of windows) {
    const from = instantSeconds(window.from);
    const until = instantSeconds(window.until);
    if (from === null || until === null) continue;
    if (started >= from && started < until) {
      return window.check_date.slice(0, 10);
    }
  }
  return null;
}

export function groupTimeEntriesForReview(input: {
  entries: readonly TimeEntry[];
  breaks: readonly TimeBreak[];
  exceptions: readonly TimeException[];
  edits: readonly TimeEntryEdit[];
  windows: readonly ApprovedTimeClockWindow[];
  names: Readonly<Record<string, string>>;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
}): ReviewEmployeeGroup[] {
  if (!isYmd(input.periodStart) || !isYmd(input.periodEnd)) return [];

  const breaksByEntry = new Map<string, TimeBreak[]>();
  for (const row of input.breaks) {
    const current = breaksByEntry.get(row.time_entry_id) ?? [];
    current.push(row);
    breaksByEntry.set(row.time_entry_id, current);
  }
  const openExceptions = new Set(
    input.exceptions.filter((row) => row.status === "open" && row.time_entry_id).map((row) => row.time_entry_id as string),
  );
  const edited = new Set(input.edits.map((row) => row.time_entry_id));

  const groups = new Map<string, ReviewEmployeeGroup>();
  for (const entry of input.entries) {
    const started = instantSeconds(entry.started_at);
    if (started === null) continue;
    const local = ymdInTimeZone(started, input.timeZone);
    if (local < input.periodStart || local > input.periodEnd) continue;
    const breaks = [...(breaksByEntry.get(entry.id) ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const row: ReviewShiftRow = {
      entry,
      breaks,
      workedSeconds: entry.worked_seconds,
      hasOpenException: openExceptions.has(entry.id),
      noRestaurant: !entry.restaurant_id,
      edited: edited.has(entry.id),
      approvedCheckDate: approvedCheckDateForShift(entry.started_at, input.windows),
    };
    const group = groups.get(entry.employee_id) ?? {
      employeeId: entry.employee_id,
      name: input.names[entry.employee_id] ?? entry.employee_id,
      totalWorkedSeconds: 0,
      shifts: [],
    };
    group.shifts.push(row);
    group.totalWorkedSeconds += row.workedSeconds;
    groups.set(entry.employee_id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      shifts: [...group.shifts].sort((a, b) => a.entry.started_at.localeCompare(b.entry.started_at)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId));
}

export function formFromTimeEntry(
  entry: TimeEntry,
  breaks: readonly TimeBreak[],
  timeZone: string,
): Pick<
  TimeEntryFormInput,
  | "date"
  | "start"
  | "end"
  | "breaks"
  | "restaurantId"
  | "position"
  | "employeeId"
  | "originalStartedAt"
  | "originalEndedAt"
> {
  const started = instantSeconds(entry.started_at) ?? 0;
  const ended = instantSeconds(entry.ended_at) ?? started;
  const startParts = {
    date: ymdInTimeZone(started, timeZone),
    hm: hmInTimeZone(started, timeZone),
  };
  return {
    employeeId: entry.employee_id,
    restaurantId: entry.restaurant_id ?? "",
    position: entry.position,
    date: startParts.date,
    start: startParts.hm,
    end: hmInTimeZone(ended, timeZone),
    originalStartedAt: entry.started_at,
    originalEndedAt: entry.ended_at ?? undefined,
    breaks: [...breaks]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((row) => ({
        startedAt: hmInTimeZone(instantSeconds(row.started_at) ?? started, timeZone),
        endedAt: hmInTimeZone(instantSeconds(row.ended_at) ?? started, timeZone),
        breakType: row.break_type,
        paid: row.paid,
        originalStartedAt: row.started_at,
        originalEndedAt: row.ended_at,
      })),
  };
}
