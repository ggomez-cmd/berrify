export const CLOCK_EVENT_TYPES = ["clock_in", "break_start", "break_end", "clock_out"] as const;
export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];

export const CLOCK_ACTOR_TYPES = ["employee", "manager", "system"] as const;
export type ClockActorType = (typeof CLOCK_ACTOR_TYPES)[number];

export const CLOCK_SOURCES = ["web", "mobile", "kiosk", "system"] as const;
export type ClockSource = (typeof CLOCK_SOURCES)[number];

export const CLOCK_SESSION_STATES = ["working", "on_break"] as const;
export type ClockSessionState = (typeof CLOCK_SESSION_STATES)[number];

export const CLOCK_STATES = ["off_clock", "working", "on_break"] as const;
export type ClockState = (typeof CLOCK_STATES)[number];

export const TIME_ENTRY_STATUSES = ["pending", "exception"] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const BREAK_TYPES = ["meal", "rest", "other"] as const;
export type BreakType = (typeof BREAK_TYPES)[number];

export const TIME_EXCEPTION_TYPES = [
  "early",
  "late",
  "missed_in",
  "missed_out",
  "long_break",
  "unscheduled",
  "overlap",
  "missing_employment_term",
] as const;
export type TimeExceptionType = (typeof TIME_EXCEPTION_TYPES)[number];

export const TIME_EXCEPTION_STATUSES = ["open", "resolved", "dismissed"] as const;
export type TimeExceptionStatus = (typeof TIME_EXCEPTION_STATUSES)[number];

export const EARLY_LATE_GRACE_SECONDS = 5 * 60;
export const SHIFT_MATCH_WINDOW_SECONDS = 2 * 60 * 60;
export const LONG_BREAK_SECONDS = 30 * 60;
export const MEAL_BREAK_MIN_SECONDS = 20 * 60;
export const OPEN_SESSION_MISSED_OUT_SECONDS = 12 * 60 * 60;

export type ClockTransition = {
  from: ClockState;
  event: ClockEventType;
  to: ClockState;
};

export const CLOCK_TRANSITIONS: readonly ClockTransition[] = [
  { from: "off_clock", event: "clock_in", to: "working" },
  { from: "working", event: "break_start", to: "on_break" },
  { from: "on_break", event: "break_end", to: "working" },
  { from: "working", event: "clock_out", to: "off_clock" },
] as const;

export function clockStateFromSession(sessionState: ClockSessionState | null): ClockState {
  if (sessionState === null) return "off_clock";
  switch (sessionState) {
    case "working":
      return "working";
    case "on_break":
      return "on_break";
    default: {
      const exhaustive: never = sessionState;
      return exhaustive;
    }
  }
}

export function nextClockState(from: ClockState, event: ClockEventType): ClockState {
  const match = CLOCK_TRANSITIONS.find((row) => row.from === from && row.event === event);
  if (!match) {
    throw new Error(`Invalid clock transition: ${event} while ${from}`);
  }
  return match.to;
}

export function assertTransition(from: ClockState, event: ClockEventType): ClockState {
  return nextClockState(from, event);
}

export function isValidTransition(from: ClockState, event: ClockEventType): boolean {
  return CLOCK_TRANSITIONS.some((row) => row.from === from && row.event === event);
}

export function allowedEvents(from: ClockState): ClockEventType[] {
  switch (from) {
    case "off_clock":
      return ["clock_in"];
    case "working":
      return ["break_start", "clock_out"];
    case "on_break":
      return ["break_end"];
    default: {
      const exhaustive: never = from;
      return exhaustive;
    }
  }
}

export function managerForceOutValid(from: ClockState): boolean {
  return from === "working" || from === "on_break";
}

export function secondsBetween(startsAt: string | Date, endsAt: string | Date): number {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export type ShiftMatchCandidate = {
  id: string;
  restaurant_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "draft" | "published";
  employee_id: string | null;
};

export function matchPublishedShift(
  shifts: ShiftMatchCandidate[],
  employeeId: string,
  occurredAt: string | Date,
): ShiftMatchCandidate | null {
  const at = new Date(occurredAt).getTime();
  const windowMs = SHIFT_MATCH_WINDOW_SECONDS * 1000;
  const eligible = shifts.filter((shift) => {
    if (shift.status !== "published") return false;
    if (shift.employee_id !== employeeId) return false;
    const start = new Date(shift.starts_at).getTime();
    const end = new Date(shift.ends_at).getTime();
    return at >= start - windowMs && at <= end + windowMs;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((best, shift) => {
    const bestDelta = Math.abs(new Date(best.starts_at).getTime() - at);
    const nextDelta = Math.abs(new Date(shift.starts_at).getTime() - at);
    return nextDelta < bestDelta ? shift : best;
  });
}

export function resolveRestaurantId(input: {
  matchedShiftRestaurantId: string | null | undefined;
  homeRestaurantId: string | null | undefined;
}): string | null {
  return input.matchedShiftRestaurantId ?? input.homeRestaurantId ?? null;
}

export function classifyBreakType(durationSeconds: number): BreakType {
  return durationSeconds >= MEAL_BREAK_MIN_SECONDS ? "meal" : "rest";
}

export function breakIsPaid(
  breakType: BreakType,
  defaults: { mealPaid: boolean; restPaid: boolean },
): boolean {
  switch (breakType) {
    case "meal":
      return defaults.mealPaid;
    case "rest":
      return defaults.restPaid;
    case "other":
      return false;
    default: {
      const exhaustive: never = breakType;
      return exhaustive;
    }
  }
}

export type DerivedBreak = {
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  break_type: BreakType;
  paid: boolean;
};

export type TimeTotals = {
  gross_seconds: number;
  paid_break_seconds: number;
  unpaid_break_seconds: number;
  worked_seconds: number;
};

export function computeTimeTotals(
  grossSeconds: number,
  breaks: Array<Pick<DerivedBreak, "duration_seconds" | "paid">>,
): TimeTotals {
  const paid = breaks.reduce((sum, row) => sum + (row.paid ? row.duration_seconds : 0), 0);
  const unpaid = breaks.reduce((sum, row) => sum + (row.paid ? 0 : row.duration_seconds), 0);
  const gross = Math.max(0, Math.floor(grossSeconds));
  return {
    gross_seconds: gross,
    paid_break_seconds: paid,
    unpaid_break_seconds: unpaid,
    worked_seconds: Math.max(0, gross - unpaid),
  };
}

export function pairBreaks(
  events: Array<{ event_type: ClockEventType; occurred_at: string }>,
  defaults: { mealPaid: boolean; restPaid: boolean },
): DerivedBreak[] {
  const breaks: DerivedBreak[] = [];
  let openStart: string | null = null;
  for (const event of events) {
    switch (event.event_type) {
      case "break_start":
        openStart = event.occurred_at;
        break;
      case "break_end":
        if (openStart) {
          const duration = secondsBetween(openStart, event.occurred_at);
          const breakType = classifyBreakType(duration);
          breaks.push({
            started_at: openStart,
            ended_at: event.occurred_at,
            duration_seconds: duration,
            break_type: breakType,
            paid: breakIsPaid(breakType, defaults),
          });
          openStart = null;
        }
        break;
      case "clock_in":
      case "clock_out":
        break;
      default: {
        const exhaustive: never = event.event_type;
        return exhaustive;
      }
    }
  }
  return breaks;
}

export function detectSessionExceptions(input: {
  staffShiftId: string | null;
  clockInAt: string;
  shiftStartsAt: string | null;
  breaks: Array<Pick<DerivedBreak, "duration_seconds">>;
  overlapsExistingEntry: boolean;
}): TimeExceptionType[] {
  const found: TimeExceptionType[] = [];
  if (!input.staffShiftId) found.push("unscheduled");
  if (input.staffShiftId && input.shiftStartsAt) {
    const delta = Math.floor(
      (new Date(input.clockInAt).getTime() - new Date(input.shiftStartsAt).getTime()) / 1000,
    );
    if (delta < -EARLY_LATE_GRACE_SECONDS) found.push("early");
    if (delta > EARLY_LATE_GRACE_SECONDS) found.push("late");
  }
  if (input.breaks.some((row) => row.duration_seconds > LONG_BREAK_SECONDS)) found.push("long_break");
  if (input.overlapsExistingEntry) found.push("overlap");
  return found;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

export function shouldFlagMissedOut(input: {
  clockedInAt: string;
  now: string;
  shiftEndsAt: string | null;
}): boolean {
  const now = new Date(input.now).getTime();
  if (input.shiftEndsAt && now > new Date(input.shiftEndsAt).getTime()) return true;
  return secondsBetween(input.clockedInAt, input.now) >= OPEN_SESSION_MISSED_OUT_SECONDS;
}

function weekdayIndex(weekday: string): number {
  switch (weekday) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      throw new Error(`Unknown weekday: ${weekday}`);
  }
}

function zonedYmd(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    dow: weekdayIndex(read("weekday")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    second: Number(read("second")),
  };
}

function utcFromZoned(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}): Date {
  const utcGuess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second);
  const shown = zonedYmd(new Date(utcGuess), input.timeZone);
  const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  return new Date(utcGuess + (utcGuess - shownUtc));
}

export function startOfWorkweek(
  instant: Date,
  timeZone: string,
  startDow = 0,
  startTime = "00:00",
): Date {
  const [hourText, minuteText] = startTime.split(":");
  const startHour = Number(hourText);
  const startMinute = Number(minuteText);
  const local = zonedYmd(instant, timeZone);
  let daysBack = (local.dow - startDow + 7) % 7;
  const minutesNow = local.hour * 60 + local.minute;
  const minutesStart = startHour * 60 + startMinute;
  if (daysBack === 0 && minutesNow < minutesStart) daysBack = 7;
  const startDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  startDate.setUTCDate(startDate.getUTCDate() - daysBack);
  return utcFromZoned({
    year: startDate.getUTCFullYear(),
    month: startDate.getUTCMonth() + 1,
    day: startDate.getUTCDate(),
    hour: startHour,
    minute: startMinute,
    second: 0,
    timeZone,
  });
}

export function formatInTimeZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
