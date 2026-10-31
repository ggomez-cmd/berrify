import type { DailyWindowMode } from "../payroll-engine/hours/types";
import type { Cents, EmployeePayInput, EmployerSettings, OpeningYtd, TaxCode } from "../payroll-engine/types";
import { ALL_TAX_CODES } from "../payroll-engine/types";
import type {
  PayrollCloverNameRow,
  PayrollEmployeeProfileRow,
  PayrollEmployerSettingsRow,
  PayrollOpeningBalanceRow,
  PayrollOpeningBalanceTaxRow,
  PayrollPayRateRow,
} from "../types";

export type {
  PayrollCloverNameRow,
  PayrollEmployeeProfileRow,
  PayrollEmployerSettingsRow,
  PayrollOpeningBalanceRow,
  PayrollOpeningBalanceTaxRow,
  PayrollPayRateRow,
};

export type EmployerSetupSettings = EmployerSettings & {
  dailyOtMode: DailyWindowMode;
  workweekStartDow: number;
  timeZone: string;
};

export type RateLookup = {
  employeeId: string;
  restaurantId: string | null;
  position: string | null;
  onDate: string;
};

export type OpeningBalanceImportRow = {
  employeeNumber: string;
  employeeId: string | null;
  taxYear: number;
  source: string;
  grossCents: Cents;
  taxes: Array<{
    taxCode: TaxCode;
    taxableCents: Cents;
    withheldCents: Cents;
    employerCents: Cents;
  }>;
};

export type CsvLineError = {
  line: number;
  message: string;
};

export type OpeningBalancesCsvResult = {
  rows: OpeningBalanceImportRow[];
  errors: CsvLineError[];
};

export type CloverParseMaps = {
  mapping: Record<string, { employeeId: string; positionKey: string; classId: string }>;
  ignore: string[];
};

const TAX_CODE_SET = new Set<string>(ALL_TAX_CODES);

export const OPENING_BALANCES_CSV_HEADER = [
  "employee_number",
  "tax_year",
  "source",
  "gross",
  ...ALL_TAX_CODES.flatMap((code) => [`${code}_taxable`, `${code}_withheld`, `${code}_employer`]),
].join(",");

export function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/\$/g, "").replace(/,/g, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("-")) return null;
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match || !match[1]) return null;
  const dollars = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const cents = dollars * 100n + fraction;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

export function percentToBasisPoints(raw: string): number | null {
  const trimmed = raw.trim().replace(/%/g, "").replace(/,/g, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("-")) return null;
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match || !match[1]) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const bp = whole * 100n + fraction;
  if (bp > 10000n) return null;
  return Number(bp);
}

export function centsToDollarInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function basisPointsToPercentInput(bp: number): string {
  return `${Math.trunc(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
}

function asYmd(value: string): string {
  return value.slice(0, 10);
}

export function employerSettingsFor(
  rows: readonly PayrollEmployerSettingsRow[],
  checkDate: string,
): EmployerSetupSettings {
  const onDate = asYmd(checkDate);
  let latest: PayrollEmployerSettingsRow | null = null;
  for (const row of rows) {
    const from = asYmd(row.effective_from);
    if (from > onDate) continue;
    if (!latest || from > asYmd(latest.effective_from)) latest = row;
  }
  if (!latest) {
    throw new Error(`No employer settings are effective on ${onDate}`);
  }
  return {
    sutRateBp: latest.sut_rate_bp,
    swhMethod: latest.swh_method,
    payFrequency: latest.pay_frequency,
    dailyOtMode: latest.daily_ot_mode,
    workweekStartDow: latest.workweek_start_day,
    timeZone: latest.time_zone,
  };
}

function rateSpecificity(rate: PayrollPayRateRow, query: RateLookup): number | null {
  if (rate.employee_id !== query.employeeId) return null;
  if (asYmd(rate.effective_from) > query.onDate) return null;
  if (rate.restaurant_id != null && rate.restaurant_id !== query.restaurantId) return null;
  if (rate.position != null && rate.position !== query.position) return null;
  if (rate.restaurant_id != null && rate.position != null) return 3;
  if (rate.restaurant_id != null) return 2;
  if (rate.position != null) return 1;
  return 0;
}

export function rateFor(rates: readonly PayrollPayRateRow[], query: RateLookup): PayrollPayRateRow | null {
  const onDate = asYmd(query.onDate);
  const lookup = { ...query, onDate };
  let best: PayrollPayRateRow | null = null;
  let bestRank = -1;
  for (const rate of rates) {
    const rank = rateSpecificity(rate, lookup);
    if (rank === null) continue;
    if (
      !best ||
      rank > bestRank ||
      (rank === bestRank && asYmd(rate.effective_from) > asYmd(best.effective_from))
    ) {
      best = rate;
      bestRank = rank;
    }
  }
  return best;
}

function addCents(target: Partial<Record<TaxCode, Cents>>, code: TaxCode, amount: Cents) {
  target[code] = (target[code] ?? 0) + amount;
}

export function employeePayBase(
  profile: PayrollEmployeeProfileRow,
  openingBalances: readonly (PayrollOpeningBalanceRow & { taxes: readonly PayrollOpeningBalanceTaxRow[] })[],
  taxYear: number,
): Omit<EmployeePayInput, "earnings" | "hourlyWeeks"> {
  const yearRows = openingBalances.filter((row) => row.employee_id === profile.employee_id && row.tax_year === taxYear);
  const openingYtd: OpeningYtd = {
    grossCents: 0,
    taxableCents: {},
    withheldCents: {},
    employerWithheldCents: {},
  };
  for (const row of yearRows) {
    openingYtd.grossCents += row.gross_cents;
    for (const tax of row.taxes) {
      addCents(openingYtd.taxableCents, tax.tax_code, tax.taxable_cents);
      addCents(openingYtd.withheldCents, tax.tax_code, tax.withheld_cents);
      addCents(openingYtd.employerWithheldCents ?? {}, tax.tax_code, tax.employer_cents);
    }
  }

  return {
    employeeId: profile.employee_id,
    payType: profile.pay_type,
    isTipped: profile.is_tipped,
    dailyOtMultiplierPpm: profile.daily_ot_multiplier_ppm,
    weeklyOtMultiplierPpm: profile.weekly_ot_multiplier_ppm,
    youngWorkerExempt: profile.young_worker_exempt,
    additionalWithholdingCents: profile.additional_withholding_cents,
    exemption: {
      personal: profile.personal_exemption,
      veteran: profile.veteran,
      dependents: profile.dependents,
      reducedDependents: profile.reduced_dependents,
      deductionCents: profile.deduction_cents,
      annualExemptionOverrideCents: profile.annual_exemption_override_cents ?? undefined,
      biweeklyExemptionOverrideCents: profile.biweekly_exemption_override_cents ?? undefined,
    },
    openingYtd: yearRows.length > 0 ? openingYtd : undefined,
    salary:
      profile.salary_cents == null
        ? undefined
        : {
            amountCents: profile.salary_cents,
            classId: profile.default_restaurant_id,
          },
  };
}

export function cloverMappingFrom(rows: readonly PayrollCloverNameRow[]): CloverParseMaps {
  const mapping: CloverParseMaps["mapping"] = {};
  const ignore: string[] = [];
  for (const row of rows) {
    if (row.ignored) {
      ignore.push(row.clover_name);
      continue;
    }
    if (row.employee_id) {
      mapping[row.clover_name] = {
        employeeId: row.employee_id,
        positionKey: "unmapped",
        classId: "unmapped",
      };
    }
  }
  ignore.sort((a, b) => a.localeCompare(b));
  return { mapping, ignore };
}

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

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

function isTaxCode(value: string): value is TaxCode {
  return TAX_CODE_SET.has(value);
}

type TaxColumnKind = "taxable" | "withheld" | "employer";

function parseTaxHeader(header: string): { code: TaxCode; kind: TaxColumnKind } | null {
  const match = header.trim().match(/^(.+)_(taxable|withheld|employer)$/i);
  if (!match || !match[1] || !match[2]) return null;
  const code = match[1].toUpperCase();
  if (!isTaxCode(code)) return null;
  const kind = match[2].toLowerCase() as TaxColumnKind;
  return { code, kind };
}

export function parseOpeningBalancesCsv(
  csv: string,
  lookup?: Readonly<Record<string, string>>,
): OpeningBalancesCsvResult {
  const errors: CsvLineError[] = [];
  const rows: OpeningBalanceImportRow[] = [];
  const parsed = parseCsvRows(csv).filter((row) => row.some((value) => value.trim() !== ""));
  if (parsed.length === 0) {
    return { rows, errors: [{ line: 1, message: "CSV is empty" }] };
  }

  const header = (parsed[0] ?? []).map((value) => value.trim());
  const index = new Map<string, number>();
  header.forEach((value, i) => {
    const key = value.toLowerCase();
    if (key && !index.has(key)) index.set(key, i);
  });

  const required = ["employee_number", "tax_year", "source", "gross"] as const;
  for (const name of required) {
    if (index.get(name) === undefined) {
      errors.push({ line: 1, message: `Missing column ${name}` });
    }
  }

  const taxColumns: Array<{ index: number; code: TaxCode; kind: TaxColumnKind }> = [];
  header.forEach((value, i) => {
    const normalized = value.trim();
    if (!normalized) return;
    const requiredName = normalized.toLowerCase();
    if ((required as readonly string[]).includes(requiredName)) return;
    const tax = parseTaxHeader(normalized);
    if (!tax) {
      errors.push({ line: 1, message: `Unknown column ${normalized}` });
      return;
    }
    taxColumns.push({ index: i, code: tax.code, kind: tax.kind });
  });

  if (errors.length > 0) return { rows, errors };

  const seen = new Set<string>();
  parsed.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const employeeNumber = cell(row, index.get("employee_number"));
    const taxYearText = cell(row, index.get("tax_year"));
    const source = cell(row, index.get("source"));
    const grossText = cell(row, index.get("gross"));
    let rowError = false;

    if (!employeeNumber) {
      errors.push({ line, message: "employee_number is required" });
      rowError = true;
    }
    if (!source) {
      errors.push({ line, message: "source is required" });
      rowError = true;
    }
    const taxYear = Number(taxYearText);
    if (!/^\d{4}$/.test(taxYearText) || taxYear < 2000 || taxYear > 2100) {
      errors.push({ line, message: "tax_year must be a 4-digit year" });
      rowError = true;
    }
    const grossCents = dollarsToCents(grossText);
    if (grossCents === null) {
      errors.push({ line, message: "gross must be a non-negative dollar amount" });
      rowError = true;
    }

    let employeeId: string | null = null;
    if (employeeNumber && lookup) {
      const found = lookup[employeeNumber];
      if (!found) {
        errors.push({ line, message: `Unknown employee number ${employeeNumber}` });
        rowError = true;
      } else {
        employeeId = found;
      }
    }

    const taxAmounts = new Map<TaxCode, { taxableCents: number; withheldCents: number; employerCents: number }>();
    for (const column of taxColumns) {
      const raw = cell(row, column.index);
      if (!raw) continue;
      const cents = dollarsToCents(raw);
      if (cents === null) {
        errors.push({ line, message: `${column.code}_${column.kind} must be a non-negative dollar amount` });
        rowError = true;
        continue;
      }
      const current = taxAmounts.get(column.code) ?? { taxableCents: 0, withheldCents: 0, employerCents: 0 };
      switch (column.kind) {
        case "taxable":
          current.taxableCents = cents;
          break;
        case "withheld":
          current.withheldCents = cents;
          break;
        case "employer":
          current.employerCents = cents;
          break;
        default: {
          const exhaustive: never = column.kind;
          throw new Error(`Unhandled tax column kind: ${exhaustive}`);
        }
      }
      taxAmounts.set(column.code, current);
    }

    if (!employeeNumber || !source || taxYearText === "" || rowError || grossCents === null) return;

    const key = `${employeeNumber}\t${taxYear}\t${source}`;
    if (seen.has(key)) {
      errors.push({ line, message: `Duplicate employee ${employeeNumber} / ${taxYear} / ${source}` });
      return;
    }
    seen.add(key);

    rows.push({
      employeeNumber,
      employeeId,
      taxYear,
      source,
      grossCents,
      taxes: [...taxAmounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([taxCode, amounts]) => ({ taxCode, ...amounts })),
    });
  });

  return { rows, errors };
}
