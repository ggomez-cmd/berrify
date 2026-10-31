import { roundHalfUpDiv } from "../money";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const DEFAULT_DAILY_LIMIT_SECONDS = 8 * 3600;
export const DEFAULT_WEEKLY_LIMIT_SECONDS = 40 * 3600;
export const SECONDS_PER_DAY = 24 * 3600;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  dow: number;
  hour: number;
  minute: number;
  second: number;
};

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function ymdString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isHm(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

export function parseHm(value: string): { hour: number; minute: number } | null {
  if (!isHm(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function addCalendarDays(ymd: string, days: number): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return ymdString(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function instantSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(seconds: number, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(new Date(seconds * 1000));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = read("weekday");
  const dow = WEEKDAY_INDEX[weekday];
  if (dow === undefined) {
    throw new Error(`Unknown weekday: ${weekday}`);
  }
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    dow,
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    second: Number(read("second")),
  };
}

export function ymdInTimeZone(seconds: number, timeZone: string): string {
  const local = zonedParts(seconds, timeZone);
  return ymdString(local.year, local.month, local.day);
}

export type ResolveZonedInput = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
};

export type ResolvedZonedInstant = {
  seconds: number | null;
  ambiguous: boolean;
  nonexistent: boolean;
};

function sameLocal(shown: ZonedParts, input: ResolveZonedInput): boolean {
  return (
    shown.year === input.year &&
    shown.month === input.month &&
    shown.day === input.day &&
    shown.hour === input.hour &&
    shown.minute === input.minute &&
    shown.second === input.second
  );
}

function compareLocal(shown: ZonedParts, input: ResolveZonedInput): number {
  if (shown.year !== input.year) return shown.year - input.year;
  if (shown.month !== input.month) return shown.month - input.month;
  if (shown.day !== input.day) return shown.day - input.day;
  if (shown.hour !== input.hour) return shown.hour - input.hour;
  if (shown.minute !== input.minute) return shown.minute - input.minute;
  return shown.second - input.second;
}

function zoneOffsetSeconds(seconds: number, timeZone: string): number {
  const local = zonedParts(seconds, timeZone);
  return (
    Math.floor(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) / 1000) -
    seconds
  );
}

function matchingZonedInstants(input: ResolveZonedInput): number[] {
  const targetUtc = Math.floor(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second) / 1000,
  );
  const found = new Set<number>();
  // Any instant showing this wall time uses one of the zone's offsets within a day of it.
  for (const probe of [targetUtc - 86_400, targetUtc, targetUtc + 86_400]) {
    const guess = targetUtc - zoneOffsetSeconds(probe, input.timeZone);
    if (sameLocal(zonedParts(guess, input.timeZone), input)) found.add(guess);
  }
  return [...found].sort((a, b) => a - b);
}

function firstInstantAfterGap(input: ResolveZonedInput): number {
  // Real UTC offsets stay within ±14 h, so ±26 h around the naive instant brackets the gap.
  const targetUtc = Math.floor(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second) / 1000,
  );
  let lo = targetUtc - 26 * 3600;
  let hi = targetUtc + 26 * 3600;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (compareLocal(zonedParts(mid, input.timeZone), input) >= 0) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function resolveZonedInstant(
  input: ResolveZonedInput,
  options: { onNonexistent: "reject" | "after_gap" } = { onNonexistent: "reject" },
): ResolvedZonedInstant {
  const matches = matchingZonedInstants(input);
  if (matches.length > 0) {
    return { seconds: matches[0] ?? null, ambiguous: matches.length > 1, nonexistent: false };
  }
  if (options.onNonexistent === "after_gap") {
    return { seconds: firstInstantAfterGap(input), ambiguous: false, nonexistent: true };
  }
  return { seconds: null, ambiguous: false, nonexistent: true };
}

export function utcSecondsFromZoned(input: ResolveZonedInput): number {
  const resolved = resolveZonedInstant(input, { onNonexistent: "reject" });
  if (resolved.seconds === null) {
    throw new Error(
      `Local time ${ymdString(input.year, input.month, input.day)} ${pad2(input.hour)}:${pad2(input.minute)}:${pad2(input.second)} does not exist in ${input.timeZone}`,
    );
  }
  return resolved.seconds;
}

function workweekBoundarySeconds(
  ymd: string,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const resolved = resolveZonedInstant(
    {
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour,
      minute,
      second: 0,
      timeZone,
    },
    { onNonexistent: "after_gap" },
  );
  if (resolved.seconds === null) {
    throw new Error(`Unable to resolve workweek boundary ${ymd} ${pad2(hour)}:${pad2(minute)} in ${timeZone}`);
  }
  return resolved.seconds;
}

export function localMidnightSeconds(ymd: string, timeZone: string): number {
  const resolved = resolveZonedInstant(
    {
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: 0,
      minute: 0,
      second: 0,
      timeZone,
    },
    { onNonexistent: "after_gap" },
  );
  if (resolved.seconds === null) {
    throw new Error(`Could not resolve local midnight ${ymd} in ${timeZone}`);
  }
  return resolved.seconds;
}

export function nextLocalMidnightSeconds(seconds: number, timeZone: string): number {
  return localMidnightSeconds(addCalendarDays(ymdInTimeZone(seconds, timeZone), 1), timeZone);
}

export function startOfWorkweekSeconds(
  seconds: number,
  timeZone: string,
  startDow: number,
  startTime: string,
): number {
  const hm = parseHm(startTime);
  if (!hm) {
    throw new Error(`Invalid workweek start time: ${startTime}`);
  }
  const local = zonedParts(seconds, timeZone);
  const daysBack = (local.dow - startDow + 7) % 7;
  const startYmd = addCalendarDays(ymdString(local.year, local.month, local.day), -daysBack);
  const candidate = workweekBoundarySeconds(startYmd, hm.hour, hm.minute, timeZone);
  if (seconds < candidate) {
    return workweekBoundarySeconds(addCalendarDays(startYmd, -7), hm.hour, hm.minute, timeZone);
  }
  return candidate;
}

export function nextWorkweekStartSeconds(
  seconds: number,
  timeZone: string,
  startDow: number,
  startTime: string,
): number {
  const current = startOfWorkweekSeconds(seconds, timeZone, startDow, startTime);
  const currentYmd = ymdInTimeZone(current, timeZone);
  const hm = parseHm(startTime);
  if (!hm) {
    throw new Error(`Invalid workweek start time: ${startTime}`);
  }
  const nextYmd = addCalendarDays(currentYmd, 7);
  return workweekBoundarySeconds(nextYmd, hm.hour, hm.minute, timeZone);
}

export function workweekIdsForPeriod(input: {
  timeZone: string;
  workweekStartDow: number;
  workweekStartTime: string;
  periodStart: string;
  periodEnd: string;
}): string[] {
  const periodStart = localMidnightSeconds(input.periodStart, input.timeZone);
  const periodEnd = localMidnightSeconds(addCalendarDays(input.periodEnd, 1), input.timeZone);
  const ids: string[] = [];
  let cursor = startOfWorkweekSeconds(
    periodStart,
    input.timeZone,
    input.workweekStartDow,
    input.workweekStartTime,
  );
  while (cursor < periodEnd) {
    ids.push(ymdInTimeZone(cursor, input.timeZone));
    cursor = nextWorkweekStartSeconds(
      cursor,
      input.timeZone,
      input.workweekStartDow,
      input.workweekStartTime,
    );
  }
  return ids;
}

export function secondsToHoursHundredths(seconds: number): number {
  if (seconds === 0) return 0;
  return Number(roundHalfUpDiv(BigInt(seconds) * 100n, 3600n));
}

export function hoursNumberToHundredths(hours: number): number {
  return Number(roundHalfUpDiv(BigInt(Math.round(hours * 1_000_000)), 10_000n));
}
