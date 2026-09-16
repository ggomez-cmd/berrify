import { formatDuration } from "./format";
import { iifField } from "./invoice-extract";
import {
  hoursFromSeconds,
  roundMoney,
  ymdInTimeZone,
  type PayrollLine,
} from "./payroll";

export type PayrollExportMeta = {
  restaurantName: string;
  restaurantSlug: string;
  periodStart: Date;
  periodEnd: Date;
  timeZone: string;
};

function csvField(value: string): string {
  const safe = iifField(value);
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function qbDate(instant: Date, timeZone: string): string {
  const [year, month, day] = ymdInTimeZone(instant, timeZone).split("-");
  return `${month}/${day}/${year}`;
}

export function payrollFileStem(meta: PayrollExportMeta): string {
  const start = ymdInTimeZone(meta.periodStart, meta.timeZone);
  return `${meta.restaurantSlug}-payroll-${start}`;
}

export function toPayrollCsv(lines: PayrollLine[], meta: PayrollExportMeta): string {
  const periodStart = ymdInTimeZone(meta.periodStart, meta.timeZone);
  const periodEnd = ymdInTimeZone(new Date(meta.periodEnd.getTime() - 1), meta.timeZone);
  const header = "Employee,Restaurant,Period start,Period end,Regular hours,OT hours,Rate,Gross";
  const rows = lines.map((line) =>
    [
      csvField(line.full_name),
      csvField(meta.restaurantName),
      csvField(periodStart),
      csvField(periodEnd),
      String(hoursFromSeconds(line.regular_seconds)),
      String(hoursFromSeconds(line.ot_seconds)),
      String(roundMoney(line.hourly_rate)),
      String(roundMoney(line.gross)),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function toPayrollTimeActivityIif(lines: PayrollLine[], meta: PayrollExportMeta): string {
  const date = qbDate(meta.periodStart, meta.timeZone);
  const header =
    "!TIMEACT\tDATE\tJOB\tEMP\tITEM\tPITEM\tDURATION\tPROJ\tNOTE\tXFERTOPAYROLL\tBILLINGSTATUS";
  const rows: string[] = [];
  for (const line of lines) {
    if (line.regular_seconds > 0) {
      rows.push(timeActRow(date, line.full_name, "Hourly", line.regular_seconds, meta.restaurantName));
    }
    if (line.ot_seconds > 0) {
      rows.push(timeActRow(date, line.full_name, "Overtime", line.ot_seconds, meta.restaurantName));
    }
  }
  return [header, ...rows].join("\n") + "\n";
}

function timeActRow(
  date: string,
  employeeName: string,
  payrollItem: "Hourly" | "Overtime",
  seconds: number,
  restaurantName: string,
): string {
  return [
    "TIMEACT",
    date,
    "",
    iifField(employeeName),
    "",
    iifField(payrollItem),
    formatDuration(seconds),
    "",
    iifField(restaurantName),
    "Y",
    "0",
  ].join("\t");
}
