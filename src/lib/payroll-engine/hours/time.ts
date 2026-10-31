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

export function zonedParts(seconds: number, timeZone: string): ZonedParts {
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
  }).formatToParts(new Date(seconds * 1000));
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

export function utcSecondsFromZoned(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}): number {
  let guess = Math.floor(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second) / 1000,
  );
  for (let i = 0; i < 3; i += 1) {
    const shown = zonedParts(guess, input.timeZone);
    const shownUtc = Math.floor(
      Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second) / 1000,
    );
    const targetUtc = Math.floor(
      Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second) / 1000,
    );
    const next = guess + (targetUtc - shownUtc);
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}

export function localMidnightSeconds(ymd: string, timeZone: string): number {
  return utcSecondsFromZoned({
    year: Number(ymd.slice(0, 4)),
    month: Number(ymd.slice(5, 7)),
    day: Number(ymd.slice(8, 10)),
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  });
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
  let daysBack = (local.dow - startDow + 7) % 7;
  const minutesNow = local.hour * 60 + local.minute;
  const minutesStart = hm.hour * 60 + hm.minute;
  if (daysBack === 0 && minutesNow < minutesStart) daysBack = 7;
  const startYmd = addCalendarDays(ymdString(local.year, local.month, local.day), -daysBack);
  return utcSecondsFromZoned({
    year: Number(startYmd.slice(0, 4)),
    month: Number(startYmd.slice(5, 7)),
    day: Number(startYmd.slice(8, 10)),
    hour: hm.hour,
    minute: hm.minute,
    second: 0,
    timeZone,
  });
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
  return utcSecondsFromZoned({
    year: Number(nextYmd.slice(0, 4)),
    month: Number(nextYmd.slice(5, 7)),
    day: Number(nextYmd.slice(8, 10)),
    hour: hm.hour,
    minute: hm.minute,
    second: 0,
    timeZone,
  });
}

export function secondsToHoursHundredths(seconds: number): number {
  if (seconds === 0) return 0;
  return Number(roundHalfUpDiv(BigInt(seconds) * 100n, 3600n));
}

export function hoursNumberToHundredths(hours: number): number {
  return Number(roundHalfUpDiv(BigInt(Math.round(hours * 1_000_000)), 10_000n));
}
