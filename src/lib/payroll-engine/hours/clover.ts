import { collectOverlapErrors, validateShift, workedIntervals } from "./shifts";
import {
  hoursNumberToHundredths,
  isoFromSeconds,
  pad2,
  resolveZonedInstant,
  secondsToHoursHundredths,
} from "./time";
import type {
  BreakKind,
  CloverParseInput,
  CloverParseResult,
  CloverPeriod,
  CloverReconciliation,
  ShiftBreak,
  WorkedShift,
} from "./types";

const HEADER_NAME = "name";
const CLOCK_IN_DATE = "clock in date";
const CLOCK_IN_TIME = "clock in time";
const CLOCK_OUT_DATE = "clock out date";
const CLOCK_OUT_TIME = "clock out time";
const BREAK_START = "break start";
const BREAK_END = "break end";
const BREAK_TYPE = "break type";
const BREAK_LENGTH = "break length";
const TOTAL_PAID_HOURS = "total paid hours";
const KNOWN_HEADERS = new Set([
  HEADER_NAME,
  CLOCK_IN_DATE,
  CLOCK_IN_TIME,
  CLOCK_OUT_DATE,
  CLOCK_OUT_TIME,
  BREAK_START,
  BREAK_END,
  BREAK_TYPE,
  BREAK_LENGTH,
  TOTAL_PAID_HOURS,
]);

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (quoted) {
    row.push(field);
    rows.push(row);
  } else if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

function isSeparatorRow(row: string[]): boolean {
  return row.length > 0 && row.every((value) => value.trim() === "" || /^-+$/.test(value.trim()));
}

function isHeaderCandidate(row: string[]): boolean {
  const headers = row.map((value) => normalizeHeader(value));
  if (headers[0] === HEADER_NAME) return true;
  let hits = 0;
  for (const header of headers) {
    if (KNOWN_HEADERS.has(header)) hits += 1;
  }
  return hits >= 2;
}

function parsePeriodLine(row: string[]): CloverPeriod | null {
  const joined = row.map((value) => value.trim()).filter(Boolean).join(" ");
  const match = joined.match(
    /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i,
  );
  if (!match || !match[1] || !match[2]) return null;
  const start = parseDateToYmd(match[1]);
  const end = parseDateToYmd(match[2]);
  if (!start || !end) return null;
  return { start, end };
}

export function parseDateToYmd(value: string): string | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!us || !us[1] || !us[2] || !us[3]) return null;
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

export function parseTimeToHms(value: string): { hour: number; minute: number; second: number } | null {
  const trimmed = value.trim();
  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampm && ampm[1] && ampm[2] && ampm[4]) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    const second = Number(ampm[3] ?? "0");
    const mer = ampm[4].toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59 || second > 59) return null;
    if (mer === "am") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return { hour, minute, second };
  }
  const military = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!military || !military[1] || !military[2]) return null;
  const hour = Number(military[1]);
  const minute = Number(military[2]);
  const second = Number(military[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function formatHms(hms: { hour: number; minute: number; second: number }): string {
  const base = `${pad2(hms.hour)}:${pad2(hms.minute)}`;
  return hms.second === 0 ? base : `${base}:${pad2(hms.second)}`;
}

function resolveLocalSeconds(
  ymd: string,
  hms: { hour: number; minute: number; second: number },
  timeZone: string,
): { seconds: number | null; ambiguous: boolean; nonexistent: boolean } {
  return resolveZonedInstant({
    year: Number(ymd.slice(0, 4)),
    month: Number(ymd.slice(5, 7)),
    day: Number(ymd.slice(8, 10)),
    hour: hms.hour,
    minute: hms.minute,
    second: hms.second,
    timeZone,
  });
}

function parseHoursCell(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function breakPaid(label: string): boolean | null {
  const lower = label.toLowerCase();
  if (lower.includes("unpaid")) return false;
  if (lower.includes("paid")) return true;
  return null;
}

function breakKind(label: string): BreakKind {
  const lower = label.toLowerCase();
  if (lower.includes("meal")) return "meal";
  if (lower.includes("rest")) return "rest";
  return "other";
}

function placeTimeOnShift(
  time: { hour: number; minute: number; second: number },
  inYmd: string,
  outYmd: string,
  start: number,
  end: number,
  timeZone: string,
): number | null {
  const onIn = resolveLocalSeconds(inYmd, time, timeZone);
  if (onIn.seconds === null) return null;
  if (onIn.seconds >= start && onIn.seconds <= end) return onIn.seconds;
  if (inYmd !== outYmd) {
    const onOut = resolveLocalSeconds(outYmd, time, timeZone);
    if (onOut.seconds === null) return null;
    if (onOut.seconds >= start && onOut.seconds <= end) return onOut.seconds;
  }
  if (onIn.seconds >= start) return onIn.seconds;
  return resolveLocalSeconds(outYmd, time, timeZone).seconds;
}

type ColumnMap = {
  name: number;
  inDate: number;
  inTime: number;
  outDate: number;
  outTime: number;
  breakStart?: number;
  breakEnd?: number;
  breakType?: number;
  breakLength?: number;
  paidHours?: number;
};

function mapColumns(header: string[], errors: string[]): ColumnMap | null {
  const index = new Map<string, number>();
  header.forEach((value, i) => {
    const key = normalizeHeader(value);
    if (key && !index.has(key)) index.set(key, i);
  });
  const required: Array<[keyof ColumnMap, string]> = [
    ["name", HEADER_NAME],
    ["inDate", CLOCK_IN_DATE],
    ["inTime", CLOCK_IN_TIME],
    ["outDate", CLOCK_OUT_DATE],
    ["outTime", CLOCK_OUT_TIME],
  ];
  const mapped: Partial<ColumnMap> = {
    breakStart: index.get(BREAK_START),
    breakEnd: index.get(BREAK_END),
    breakType: index.get(BREAK_TYPE),
    breakLength: index.get(BREAK_LENGTH),
    paidHours: index.get(TOTAL_PAID_HOURS),
  };
  const hasAnyBreakColumn =
    mapped.breakStart !== undefined ||
    mapped.breakEnd !== undefined ||
    mapped.breakType !== undefined ||
    mapped.breakLength !== undefined;
  if (hasAnyBreakColumn) {
    for (const headerName of [BREAK_START, BREAK_END, BREAK_TYPE]) {
      if (index.get(headerName) === undefined) {
        errors.push(`Clover header is missing "${headerName}"`);
        return null;
      }
    }
  }
  for (const [field, headerName] of required) {
    const found = index.get(headerName);
    if (found === undefined) {
      errors.push(`Clover header is missing "${headerName}"`);
      return null;
    }
    mapped[field] = found;
  }
  return mapped as ColumnMap;
}

type ParsedName = {
  name: string;
  shifts: WorkedShift[];
  parsedSeconds: number;
  cloverHours: number | null;
};

export function parseCloverShifts(input: CloverParseInput): CloverParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsvRows(input.csv);
  let period: CloverPeriod | null = null;
  if (rows[1]) period = parsePeriodLine(rows[1]);
  if (!period) {
    for (const row of rows.slice(0, 5)) {
      period = parsePeriodLine(row);
      if (period) break;
    }
  }
  if (!period) errors.push("Clover file is missing a Payroll Period line");

  const ignore = new Set(input.ignore);
  const names = new Map<string, ParsedName>();
  let columns: ColumnMap | null = null;
  let grandCloverHours: number | null = null;
  const usedShiftIds = new Map<string, number>();

  const ensureName = (name: string): ParsedName => {
    const existing = names.get(name);
    if (existing) return existing;
    const created: ParsedName = { name, shifts: [], parsedSeconds: 0, cloverHours: null };
    names.set(name, created);
    return created;
  };

  for (const row of rows) {
    if (row.length === 0 || row.every((value) => value.trim() === "")) continue;
    if (isSeparatorRow(row)) {
      continue;
    }
    const first = (row[0] ?? "").trim();
    if (isHeaderCandidate(row)) {
      columns = mapColumns(row, errors);
      continue;
    }
    if (/^totals for /i.test(first)) {
      const name = first.slice("Totals for ".length).trim();
      const parsed = ensureName(name);
      const hours = columns ? parseHoursCell(cell(row, columns.paidHours)) : parseHoursCell(row[12] ?? "");
      parsed.cloverHours = hours;
      continue;
    }
    if (/^totals$/i.test(first)) {
      const hours = columns ? parseHoursCell(cell(row, columns.paidHours)) : parseHoursCell(row[12] ?? "");
      grandCloverHours = hours;
      continue;
    }
    if (/^payroll period$/i.test(first)) continue;
    if (!columns) continue;
    const name = cell(row, columns.name);
    if (!name) continue;
    const parsed = ensureName(name);
    const inDate = parseDateToYmd(cell(row, columns.inDate));
    const outDate = parseDateToYmd(cell(row, columns.outDate));
    const inTime = parseTimeToHms(cell(row, columns.inTime));
    const outTime = parseTimeToHms(cell(row, columns.outTime));
    if (!inDate || !outDate || !inTime || !outTime) {
      errors.push(`Clover row for ${name} has an invalid clock-in or clock-out`);
      continue;
    }
    const startResolved = resolveLocalSeconds(inDate, inTime, input.timeZone);
    const endResolved = resolveLocalSeconds(outDate, outTime, input.timeZone);
    if (startResolved.nonexistent || endResolved.nonexistent || startResolved.seconds === null || endResolved.seconds === null) {
      errors.push(`Clover row for ${name} has a nonexistent local time`);
      continue;
    }
    if (startResolved.ambiguous) {
      warnings.push(
        `Clover row for ${name} uses the first occurrence of ambiguous local time ${inDate} ${formatHms(inTime)}`,
      );
    }
    if (endResolved.ambiguous) {
      warnings.push(
        `Clover row for ${name} uses the first occurrence of ambiguous local time ${outDate} ${formatHms(outTime)}`,
      );
    }
    const start = startResolved.seconds;
    const end = endResolved.seconds;
    if (end < start) {
      errors.push(`Clover row for ${name} ends before it starts`);
      continue;
    }

    const breaks: ShiftBreak[] = [];
    const breakStartText = cell(row, columns.breakStart);
    const breakEndText = cell(row, columns.breakEnd);
    const breakTypeText = cell(row, columns.breakType);
    const breakLengthText = cell(row, columns.breakLength);
    let breakError = false;
    if (breakStartText || breakEndText || breakTypeText || breakLengthText) {
      if (!breakStartText || !breakEndText || !breakTypeText) {
        errors.push(`Clover row for ${name} has an incomplete break`);
        breakError = true;
      } else {
        const breakStartHms = parseTimeToHms(breakStartText);
        const breakEndHms = parseTimeToHms(breakEndText);
        if (!breakStartHms || !breakEndHms) {
          errors.push(`Clover row for ${name} has an invalid break time`);
          breakError = true;
        } else {
          const paid = breakPaid(breakTypeText);
          if (paid === null) {
            errors.push(`Clover row for ${name} has a break without Paid/Unpaid`);
            breakError = true;
          }
          const breakStart = placeTimeOnShift(breakStartHms, inDate, outDate, start, end, input.timeZone);
          let breakEnd = placeTimeOnShift(breakEndHms, inDate, outDate, start, end, input.timeZone);
          if (breakStart === null || breakEnd === null) {
            errors.push(`Clover row for ${name} has a nonexistent local break time`);
            breakError = true;
          } else if (paid !== null && !breakError) {
            if (breakEnd < breakStart) {
              breakEnd += 24 * 3600;
            }
            breaks.push({
              startedAt: isoFromSeconds(breakStart),
              endedAt: isoFromSeconds(breakEnd),
              type: breakKind(breakTypeText),
              paid,
            });
          }
        }
      }
    }
    if (breakError) continue;

    const mapping = input.mapping[name];
    const employeeId = mapping?.employeeId ?? name;
    const inTimeText = cell(row, columns.inTime);
    const baseId = `clover:${employeeId}:${name}:${inDate}T${inTimeText}`;
    const used = (usedShiftIds.get(baseId) ?? 0) + 1;
    usedShiftIds.set(baseId, used);
    const shift: WorkedShift = {
      id: used === 1 ? baseId : `${baseId}:${used}`,
      employeeId,
      positionKey: mapping?.positionKey ?? "unmapped",
      classId: mapping?.classId ?? "unmapped",
      startedAt: isoFromSeconds(start),
      endedAt: isoFromSeconds(end),
      breaks,
      source: "clover",
    };
    parsed.shifts.push(shift);
    parsed.parsedSeconds += workedIntervals(shift).reduce((sum, interval) => sum + (interval.end - interval.start), 0);
  }

  const unmatchedNames: string[] = [];
  const ignored: CloverParseResult["report"]["ignored"] = [];
  const reconciliations: CloverReconciliation[] = [];
  const shifts: WorkedShift[] = [];

  for (const parsed of names.values()) {
    const mapped = input.mapping[parsed.name];
    const isIgnored = ignore.has(parsed.name);
    const parsedHours = secondsToHoursHundredths(parsed.parsedSeconds);
    if (parsed.cloverHours !== null) {
      const cloverHours = hoursNumberToHundredths(parsed.cloverHours);
      const warning = Math.abs(parsedHours - cloverHours) > 1;
      reconciliations.push({
        name: parsed.name,
        parsedHoursHundredths: parsedHours,
        cloverHoursHundredths: cloverHours,
        warning,
      });
      if (warning) {
        warnings.push(
          `Totals for ${parsed.name} is ${parsed.cloverHours} h but parsed worked time is ${(parsedHours / 100).toFixed(2)} h`,
        );
      }
    }
    if (isIgnored) {
      ignored.push({ name: parsed.name, hoursHundredths: parsedHours });
      continue;
    }
    if (!mapped) {
      unmatchedNames.push(parsed.name);
      errors.push(`Unmatched Clover name ${parsed.name}`);
      continue;
    }
    for (const shift of parsed.shifts) {
      if (!validateShift(shift, errors)) continue;
      shifts.push(shift);
    }
  }

  collectOverlapErrors(shifts, errors);
  const seen = new Set<string>();
  for (const shift of shifts) {
    const key = `${shift.employeeId}\t${shift.startedAt}\t${shift.endedAt}\t${shift.positionKey}`;
    if (seen.has(key)) {
      errors.push(`Duplicate Clover shift for ${shift.employeeId} at ${shift.startedAt}`);
    }
    seen.add(key);
  }

  const ignoredSeconds = ignored.reduce((sum, row) => {
    const parsed = names.get(row.name);
    return sum + (parsed?.parsedSeconds ?? 0);
  }, 0);
  const mappedSeconds = shifts.reduce(
    (sum, shift) => sum + workedIntervals(shift).reduce((inner, interval) => inner + (interval.end - interval.start), 0),
    0,
  );
  const grandParsedHoursHundredths = secondsToHoursHundredths(mappedSeconds + ignoredSeconds);
  if (grandCloverHours !== null) {
    const cloverHundredths = hoursNumberToHundredths(grandCloverHours);
    if (Math.abs(grandParsedHoursHundredths - cloverHundredths) > 1) {
      warnings.push(
        `Grand Totals is ${grandCloverHours} h but mapped + ignored parsed time is ${(grandParsedHoursHundredths / 100).toFixed(2)} h`,
      );
    }
  }

  unmatchedNames.sort();
  ignored.sort((a, b) => a.name.localeCompare(b.name));
  reconciliations.sort((a, b) => a.name.localeCompare(b.name));

  return {
    shifts,
    period,
    report: {
      unmatchedNames,
      ignored,
      reconciliations,
      grandParsedHoursHundredths,
      grandCloverHoursHundredths: grandCloverHours === null ? null : hoursNumberToHundredths(grandCloverHours),
      warnings,
      errors,
    },
  };
}
