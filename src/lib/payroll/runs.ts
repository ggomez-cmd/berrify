import {
  allocateLargestRemainder,
  buildHourlyWeeks,
  computePayrollLiabilities,
  computePayrollRun,
  mealBreakFlags,
  parseCloverShifts,
  shiftsFromTimeEntries,
  splitHours,
} from "../payroll-engine";
import { addCalendarDays, instantSeconds, workweekIdsForPeriod, ymdInTimeZone } from "../payroll-engine/hours/time";
import type {
  HoursSource,
  PositionRate,
  TimeBreakRow,
  TimeEntryRow,
  WeekTips,
  WorkedShift,
} from "../payroll-engine/hours/types";
import type {
  ClassCost,
  ClosingYtd,
  CodeAmount,
  EarningsKind,
  EarningsLine,
  EarningsLineInput,
  EmployeePayInput,
  EmployeePayType,
  KindHoursAmount,
  OpeningYtd,
  PayrollCheck,
  PayrollRunInput,
  PayrollRunResult,
  TaxCode,
  TaxLine,
} from "../payroll-engine/types";
import { ALL_TAX_CODES, EMPTY_TAX_YTD } from "../payroll-engine/types";
import type {
  PayrollCloverNameRow,
  PayrollEmployeeProfileRow,
  PayrollEmployerSettingsRow,
  PayrollOpeningBalanceTaxRow,
  PayrollOpeningBalanceWithTaxes,
  PayrollPayRateRow,
  PayrollRunStatus,
  PayrollRunWithChecks,
} from "../types";
import {
  cloverMappingFrom,
  employeePayBase,
  employerSettingsFor,
  rateFor,
  type EmployerSetupSettings,
} from "./setup";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPLOYER_ONLY_CODES = new Set<TaxCode>(["FED-FUT", "FSE", "SUT"]);

export function asUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function addCents(target: Partial<Record<TaxCode, number>>, code: TaxCode, amount: number) {
  target[code] = (target[code] ?? 0) + amount;
}

function emptyOpening(): OpeningYtd {
  return {
    grossCents: 0,
    taxableCents: {},
    withheldCents: {},
    employerWithheldCents: {},
  };
}

export type YtdOpeningBalance = {
  employeeId: string;
  taxYear: number;
  grossCents: number;
  taxes: Array<{
    taxCode: TaxCode;
    taxableCents: number;
    withheldCents: number;
    employerCents: number;
  }>;
};

export type YtdPriorCheckTax = {
  employeeId: string;
  taxYear: number;
  checkDate: string;
  status: PayrollRunStatus;
  side: "employee" | "employer";
  taxCode: TaxCode;
  taxableCents: number;
  amountCents: number;
};

export type YtdPriorGross = {
  employeeId: string;
  taxYear: number;
  checkDate: string;
  status: PayrollRunStatus;
  grossCents: number;
};

export function openingBalancesForYtd(
  rows: readonly (Pick<PayrollOpeningBalanceWithTaxes, "employee_id" | "tax_year" | "gross_cents"> & {
    payroll_opening_balance_taxes?: readonly Pick<
      PayrollOpeningBalanceTaxRow,
      "tax_code" | "taxable_cents" | "withheld_cents" | "employer_cents"
    >[];
    taxes?: readonly Pick<
      PayrollOpeningBalanceTaxRow,
      "tax_code" | "taxable_cents" | "withheld_cents" | "employer_cents"
    >[];
  })[],
): YtdOpeningBalance[] {
  return rows.map((row) => ({
    employeeId: row.employee_id,
    taxYear: row.tax_year,
    grossCents: row.gross_cents,
    taxes: (row.payroll_opening_balance_taxes ?? row.taxes ?? []).map((tax) => ({
      taxCode: tax.tax_code,
      taxableCents: tax.taxable_cents,
      withheldCents: tax.withheld_cents,
      employerCents: tax.employer_cents,
    })),
  }));
}

export function ytdFromHistory(
  openingBalances: readonly YtdOpeningBalance[],
  priorApprovedCheckTaxes: readonly YtdPriorCheckTax[],
  priorGross: readonly YtdPriorGross[],
  taxYear: number,
): Map<string, OpeningYtd> {
  const byEmployee = new Map<string, OpeningYtd>();

  const ensure = (employeeId: string): OpeningYtd => {
    const current = byEmployee.get(employeeId);
    if (current) return current;
    const created = emptyOpening();
    byEmployee.set(employeeId, created);
    return created;
  };

  for (const row of openingBalances) {
    if (row.taxYear !== taxYear) continue;
    const ytd = ensure(row.employeeId);
    ytd.grossCents += row.grossCents;
    for (const tax of row.taxes) {
      addCents(ytd.taxableCents, tax.taxCode, tax.taxableCents);
      addCents(ytd.withheldCents, tax.taxCode, tax.withheldCents);
      addCents(ytd.employerWithheldCents ?? {}, tax.taxCode, tax.employerCents);
    }
  }

  for (const row of priorGross) {
    if (row.taxYear !== taxYear || row.status !== "approved") continue;
    ensure(row.employeeId).grossCents += row.grossCents;
  }

  const taxableSeen = new Set<string>();
  for (const row of priorApprovedCheckTaxes) {
    if (row.taxYear !== taxYear || row.status !== "approved") continue;
    const ytd = ensure(row.employeeId);
    if (row.side === "employee") {
      addCents(ytd.withheldCents, row.taxCode, row.amountCents);
    } else {
      addCents(ytd.employerWithheldCents ?? {}, row.taxCode, row.amountCents);
    }
    const countTaxable = row.side === "employee" || EMPLOYER_ONLY_CODES.has(row.taxCode);
    const key = `${row.employeeId}\t${row.checkDate}\t${row.taxCode}`;
    if (countTaxable && !taxableSeen.has(key)) {
      addCents(ytd.taxableCents, row.taxCode, row.taxableCents);
      taxableSeen.add(key);
    }
  }

  return byEmployee;
}

export type ManualAdjustmentInput = {
  employeeId: string;
  amountCents: number;
  reason?: string | null;
  classId?: string | null;
  hoursHundredths?: number;
  rateCents?: number;
};

export type PayrollRunSettingsSnapshot = EmployerSetupSettings & {
  workweekStartTime: string;
  periodStart: string;
  periodEnd: string;
};

export type PayrollRunInputsSnapshot = PayrollRunInput & {
  hoursSource: HoursSource;
  periodStart: string;
  periodEnd: string;
  shifts: WorkedShift[];
  tips: WeekTips[];
  adjustments: ManualAdjustmentInput[];
};

/** jsonb `run` for `save_payroll_run_draft`. Keys must match the SQL. */
export type PayrollRunDraftPayload = {
  period_start: string;
  period_end: string;
  check_date: string;
  hours_source: HoursSource;
  schedule_id: string;
  settings: PayrollRunSettingsSnapshot;
  inputs: PayrollRunInputsSnapshot;
  gross_cents: number;
  employee_withholdings_cents: number;
  net_cents: number;
  employer_taxes_cents: number;
  employer_cost_cents: number;
  cash_gross_cents: number;
  errors: string[];
  warnings: string[];
  notes: string | null;
  ytd_basis_revision: string;
};

export type PayrollYtdBasisTax = {
  id?: string;
  tax_code: TaxCode;
  taxable_cents: number;
  withheld_cents: number;
  employer_cents: number;
};

export type PayrollYtdBasisOpeningBalance = {
  id?: string;
  employee_id: string;
  tax_year: number;
  gross_cents: number;
  taxes?: readonly PayrollYtdBasisTax[];
  payroll_opening_balance_taxes?: readonly PayrollYtdBasisTax[];
};

export type PayrollYtdBasisSnapshot = {
  revision: string;
  opening_balances: PayrollYtdBasisOpeningBalance[];
  prior_check_taxes: YtdPriorCheckTax[];
  prior_gross: YtdPriorGross[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function payrollYtdBasisFromRpc(value: unknown): PayrollYtdBasisSnapshot {
  const row = asRecord(value);
  const opening = Array.isArray(row.opening_balances) ? row.opening_balances : [];
  const taxes = Array.isArray(row.prior_check_taxes) ? row.prior_check_taxes : [];
  const gross = Array.isArray(row.prior_gross) ? row.prior_gross : [];
  return {
    revision: asString(row.revision),
    opening_balances: opening.map((item) => {
      const balance = asRecord(item);
      const taxRows = Array.isArray(balance.taxes) ? balance.taxes : [];
      return {
        id: asString(balance.id) || undefined,
        employee_id: asString(balance.employee_id),
        tax_year: asNumber(balance.tax_year),
        gross_cents: asNumber(balance.gross_cents),
        taxes: taxRows.map((taxItem) => {
          const tax = asRecord(taxItem);
          return {
            id: asString(tax.id) || undefined,
            tax_code: tax.tax_code as TaxCode,
            taxable_cents: asNumber(tax.taxable_cents),
            withheld_cents: asNumber(tax.withheld_cents),
            employer_cents: asNumber(tax.employer_cents),
          };
        }),
      };
    }),
    prior_check_taxes: taxes.map((item) => {
      const tax = asRecord(item);
      return {
        employeeId: asString(tax.employee_id),
        taxYear: asNumber(tax.tax_year),
        checkDate: asString(tax.check_date).slice(0, 10),
        status: tax.status as PayrollRunStatus,
        side: tax.side as "employee" | "employer",
        taxCode: tax.tax_code as TaxCode,
        taxableCents: asNumber(tax.taxable_cents),
        amountCents: asNumber(tax.amount_cents),
      };
    }),
    prior_gross: gross.map((item) => {
      const line = asRecord(item);
      return {
        employeeId: asString(line.employee_id),
        taxYear: asNumber(line.tax_year),
        checkDate: asString(line.check_date).slice(0, 10),
        status: line.status as PayrollRunStatus,
        grossCents: asNumber(line.gross_cents),
      };
    }),
  };
}

/** jsonb earnings element for `save_payroll_run_draft` `checks`. Keys must match the SQL. */
export type PayrollCheckEarningDraftPayload = {
  kind: EarningsKind;
  restaurant_id: string | null;
  position: string | null;
  workweek_id: string | null;
  hours_hundredths: number;
  rate_cents: number | null;
  amount_cents: number;
  reason: string | null;
};

/** jsonb tax element for `save_payroll_run_draft` `checks`. Keys must match the SQL. */
export type PayrollCheckTaxDraftPayload = {
  side: "employee" | "employer";
  tax_code: TaxCode;
  taxable_cents: number;
  amount_cents: number;
};

/** jsonb array element for `save_payroll_run_draft` `checks`. Keys must match the SQL. */
export type PayrollCheckDraftPayload = {
  employee_id: string;
  pay_type: EmployeePayType;
  gross_cents: number;
  deductions_cents: number;
  net_cents: number;
  employer_tax_cents: number;
  closing_ytd: ClosingYtd;
  earnings: PayrollCheckEarningDraftPayload[];
  taxes: PayrollCheckTaxDraftPayload[];
};

export type BuildRunInputArgs = {
  checkDate: string;
  periodStart: string;
  periodEnd: string;
  hoursSource: HoursSource;
  workweekStartTime?: string;
  employerSettingsRows: readonly PayrollEmployerSettingsRow[];
  profiles: readonly PayrollEmployeeProfileRow[];
  payRates: readonly PayrollPayRateRow[];
  cloverNames?: readonly PayrollCloverNameRow[];
  timeEntries?: readonly TimeEntryRow[];
  timeBreaks?: readonly TimeBreakRow[];
  shifts?: readonly WorkedShift[];
  cloverCsv?: string;
  tips?: readonly WeekTips[];
  adjustments?: readonly ManualAdjustmentInput[];
  ytdByEmployee?: ReadonlyMap<string, OpeningYtd> | Readonly<Record<string, OpeningYtd>>;
};

export type BuildRunInputResult = {
  input: PayrollRunInput;
  settingsSnapshot: PayrollRunSettingsSnapshot | null;
  hoursSource: HoursSource;
  shifts: WorkedShift[];
  tips: WeekTips[];
  adjustments: ManualAdjustmentInput[];
  workweekIds: string[];
  errors: string[];
  warnings: string[];
};

function ytdLookup(
  source: BuildRunInputArgs["ytdByEmployee"],
  employeeId: string,
): OpeningYtd | undefined {
  if (!source) return undefined;
  if (typeof (source as { get?: unknown }).get === "function") {
    return (source as ReadonlyMap<string, OpeningYtd>).get(employeeId);
  }
  return (source as Readonly<Record<string, OpeningYtd>>)[employeeId];
}

function mealWarning(flag: { employeeId: string; shiftId: string; code: string }): string {
  switch (flag.code) {
    case "meal_not_started_by_5h":
      return `Employee ${flag.employeeId} shift ${flag.shiftId}: meal break did not start by 5 hours`;
    case "meal_too_short":
      return `Employee ${flag.employeeId} shift ${flag.shiftId}: meal break was shorter than 30 minutes`;
    default:
      return `Employee ${flag.employeeId} shift ${flag.shiftId}: ${flag.code}`;
  }
}

export function scopedEnginePositionKey(positionKey: string, classId: string): string {
  return `${positionKey}::${classId}`;
}

export type PayrollCalculationSource = {
  periodStart: string;
  periodEnd: string;
  checkDate: string;
  hoursSource: HoursSource;
  cloverCsv: string;
  tips: Readonly<Record<string, string>>;
  adjustments: ReadonlyArray<{
    employeeId: string;
    dollars: string;
    reason: string;
    restaurantId: string;
  }>;
  historyFingerprint: string;
  openingBalancesFingerprint: string;
  ytdBasisRevision: string;
};

export function payrollYtdHistoryFingerprint(
  runs: readonly {
    check_date: string;
    status: PayrollRunStatus;
    payroll_checks?: readonly {
      employee_id: string;
      gross_cents: number;
      payroll_check_taxes?: readonly {
        side: "employee" | "employer";
        tax_code: TaxCode;
        taxable_cents: number;
        amount_cents: number;
      }[];
    }[];
  }[],
): string {
  return JSON.stringify(
    [...runs]
      .map((run) => ({
        check_date: run.check_date,
        status: run.status,
        checks: [...(run.payroll_checks ?? [])]
          .map((check) => ({
            employee_id: check.employee_id,
            gross_cents: check.gross_cents,
            taxes: [...(check.payroll_check_taxes ?? [])]
              .map((tax) => ({
                side: tax.side,
                tax_code: tax.tax_code,
                taxable_cents: tax.taxable_cents,
                amount_cents: tax.amount_cents,
              }))
              .sort((a, b) => `${a.side}:${a.tax_code}`.localeCompare(`${b.side}:${b.tax_code}`)),
          }))
          .sort((a, b) => a.employee_id.localeCompare(b.employee_id)),
      }))
      .sort((a, b) => a.check_date.localeCompare(b.check_date) || a.status.localeCompare(b.status)),
  );
}

export function payrollOpeningBalancesFingerprint(
  rows: readonly (Pick<PayrollOpeningBalanceWithTaxes, "employee_id" | "tax_year" | "gross_cents" | "updated_at" | "created_at"> & {
    payroll_opening_balance_taxes?: readonly Pick<
      PayrollOpeningBalanceTaxRow,
      "tax_code" | "taxable_cents" | "withheld_cents" | "employer_cents" | "updated_at" | "created_at"
    >[];
  })[],
): string {
  return JSON.stringify(
    [...rows]
      .map((row) => ({
        employee_id: row.employee_id,
        tax_year: row.tax_year,
        gross_cents: row.gross_cents,
        created_at: row.created_at,
        updated_at: row.updated_at,
        taxes: [...(row.payroll_opening_balance_taxes ?? [])]
          .map((tax) => ({
            tax_code: tax.tax_code,
            taxable_cents: tax.taxable_cents,
            withheld_cents: tax.withheld_cents,
            employer_cents: tax.employer_cents,
            created_at: tax.created_at,
            updated_at: tax.updated_at,
          }))
          .sort((a, b) => a.tax_code.localeCompare(b.tax_code)),
      }))
      .sort((a, b) => a.employee_id.localeCompare(b.employee_id) || a.tax_year - b.tax_year),
  );
}

export function payrollCalculationSourceKey(source: PayrollCalculationSource): string {
  return JSON.stringify({
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
    checkDate: source.checkDate,
    hoursSource: source.hoursSource,
    cloverCsv: source.cloverCsv,
    tips: Object.entries(source.tips).sort(([left], [right]) => left.localeCompare(right)),
    adjustments: source.adjustments.map((row) => ({
      employeeId: row.employeeId,
      dollars: row.dollars,
      reason: row.reason,
      restaurantId: row.restaurantId,
    })),
    historyFingerprint: source.historyFingerprint,
    openingBalancesFingerprint: source.openingBalancesFingerprint,
    ytdBasisRevision: source.ytdBasisRevision,
  });
}

export function payrollCalculationIsStale(
  computedFrom: PayrollCalculationSource | null,
  current: PayrollCalculationSource,
): boolean {
  if (!computedFrom) return true;
  return payrollCalculationSourceKey(computedFrom) !== payrollCalculationSourceKey(current);
}

function uniqueMessages(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function storedRunMessages(run: Pick<PayrollRunWithChecks, "errors" | "warnings">): {
  errors: string[];
  warnings: string[];
} {
  return {
    errors: Array.isArray(run.errors) ? [...run.errors] : [],
    warnings: Array.isArray(run.warnings) ? [...run.warnings] : [],
  };
}

function adjustmentEarnings(line: ManualAdjustmentInput): EarningsLineInput {
  return {
    kind: "adjustment",
    classId: line.classId ?? null,
    amountCents: line.amountCents,
    hoursHundredths: line.hoursHundredths,
    rateCents: line.rateCents,
    reason: line.reason ?? null,
  };
}

export function buildRunInput(args: BuildRunInputArgs): BuildRunInputResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tips = [...(args.tips ?? [])];
  const adjustments = [...(args.adjustments ?? [])];
  const workweekStartTime = args.workweekStartTime ?? "00:00";

  let setup: EmployerSetupSettings | null = null;
  try {
    setup = employerSettingsFor(args.employerSettingsRows, args.checkDate);
  } catch {
    errors.push(`Missing employer settings for ${args.checkDate}`);
  }

  const timeZone = setup?.timeZone ?? "America/Puerto_Rico";
  const workweekStartDow = setup?.workweekStartDow ?? 0;
  const dailyOtMode = setup?.dailyOtMode ?? "rolling_24h";
  const settingsSnapshot: PayrollRunSettingsSnapshot | null = setup
    ? {
        ...setup,
        workweekStartTime,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }
    : null;

  let shifts: WorkedShift[] = [...(args.shifts ?? [])];
  if (args.hoursSource === "time_clock") {
    if (!args.shifts) {
      const fromClock = shiftsFromTimeEntries(args.timeEntries ?? [], args.timeBreaks ?? []);
      errors.push(...fromClock.errors);
      warnings.push(...fromClock.warnings);
      shifts = fromClock.shifts;
    }
  } else if (args.hoursSource === "clover") {
    if (!args.shifts) {
      if (!args.cloverCsv?.trim()) {
        errors.push("Missing Clover CSV");
      } else {
        const maps = cloverMappingFrom(args.cloverNames ?? []);
        const profileById = new Map(args.profiles.map((row) => [row.employee_id, row]));
        for (const [name, mapped] of Object.entries(maps.mapping)) {
          const profile = profileById.get(mapped.employeeId);
          maps.mapping[name] = {
            employeeId: mapped.employeeId,
            classId: profile?.default_restaurant_id ?? mapped.classId,
            positionKey: mapped.positionKey,
          };
        }
        const parsed = parseCloverShifts({
          csv: args.cloverCsv,
          timeZone,
          mapping: maps.mapping,
          ignore: maps.ignore,
        });
        errors.push(...parsed.report.errors);
        warnings.push(...parsed.report.warnings);
        shifts = parsed.shifts;
      }
    }
  } else {
    const exhaustive: never = args.hoursSource;
    throw new Error(`Unhandled hours source: ${exhaustive}`);
  }

  const lookbackStart = addCalendarDays(args.periodStart, -7);
  for (const shift of shifts) {
    const started = instantSeconds(shift.startedAt);
    if (started === null) continue;
    const localYmd = ymdInTimeZone(started, timeZone);
    if (localYmd > args.periodEnd || localYmd < lookbackStart) {
      warnings.push(
        `Hours for employee ${shift.employeeId} on ${localYmd} are outside the period ${args.periodStart}–${args.periodEnd}`,
      );
    }
  }

  const meal = mealBreakFlags(shifts);
  errors.push(...meal.errors);
  warnings.push(...meal.warnings);
  for (const flag of meal.flags) {
    warnings.push(mealWarning(flag));
  }

  const splitSettings = {
    timeZone,
    workweekStartDow,
    workweekStartTime,
    dailyWindow: dailyOtMode,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  };
  const split = splitHours(shifts, splitSettings);
  errors.push(...split.errors);
  warnings.push(...split.warnings);

  const positionRates: PositionRate[] = [];
  const engineShifts: WorkedShift[] = [];
  const missingRateKeys = new Set<string>();
  for (const shift of shifts) {
    const scopedKey = scopedEnginePositionKey(shift.positionKey, shift.classId);
    engineShifts.push({ ...shift, positionKey: scopedKey, classId: shift.classId });
    const started = instantSeconds(shift.startedAt);
    if (started === null) continue;
    const onDate = ymdInTimeZone(started, timeZone);
    const found = rateFor(args.payRates, {
      employeeId: shift.employeeId,
      restaurantId: asUuidOrNull(shift.classId),
      position: shift.positionKey === "unmapped" ? null : shift.positionKey,
      onDate,
    });
    if (!found) {
      const key = `${shift.employeeId}\t${shift.positionKey}\t${shift.classId}\t${onDate}`;
      if (!missingRateKeys.has(key)) {
        errors.push(`Missing rate for employee ${shift.employeeId} (${shift.positionKey}) on ${onDate}`);
        missingRateKeys.add(key);
      }
      continue;
    }
    positionRates.push({
      employeeId: shift.employeeId,
      positionKey: scopedKey,
      rateCents: found.rate_cents,
      effectiveFrom: found.effective_from.slice(0, 10),
    });
  }

  const hourly = buildHourlyWeeks({
    shifts: engineShifts,
    allocations: split.allocations,
    rates: positionRates,
    tips,
    timeZone,
    period: splitSettings,
  });
  errors.push(...hourly.errors);
  warnings.push(...hourly.warnings);

  const profileById = new Map(args.profiles.map((row) => [row.employee_id, row]));
  const employeeIds = new Set<string>();
  for (const profile of args.profiles) {
    if (profile.salary_cents != null) employeeIds.add(profile.employee_id);
  }
  for (const shift of shifts) employeeIds.add(shift.employeeId);
  for (const tip of tips) employeeIds.add(tip.employeeId);
  for (const line of adjustments) employeeIds.add(line.employeeId);
  for (const employeeId of hourly.weeks.keys()) employeeIds.add(employeeId);

  const employees: EmployeePayInput[] = [];
  for (const employeeId of [...employeeIds].sort()) {
    const profile = profileById.get(employeeId);
    if (!profile) {
      errors.push(`Missing payroll profile for employee ${employeeId}`);
      continue;
    }
    const base = employeePayBase(profile, [], Number(args.checkDate.slice(0, 4)));
    const openingYtd = ytdLookup(args.ytdByEmployee, employeeId);
    const weeks = hourly.weeks.get(employeeId) ?? [];
    const employeeAdjustments = adjustments.filter((row) => row.employeeId === employeeId).map(adjustmentEarnings);
    const salaryCents = profile.salary_cents;
    if (salaryCents != null) {
      const tipEarnings: EarningsLineInput[] = tips
        .filter((row) => row.employeeId === employeeId && row.tipsCents !== 0)
        .map((row) => ({
          kind: "tips" as const,
          amountCents: row.tipsCents,
          workweekId: row.workweekId,
          classId: profile.default_restaurant_id,
        }));
      employees.push({
        ...base,
        openingYtd,
        salary: {
          amountCents: salaryCents,
          classId: profile.default_restaurant_id,
          hoursHundredths: weeks.reduce(
            (sum, week) =>
              sum +
              week.regularHoursHundredths +
              (week.dailyOtHoursHundredths ?? 0) +
              (week.weeklyOtHoursHundredths ?? 0),
            0,
          ),
        },
        earnings: [...tipEarnings, ...employeeAdjustments],
      });
      continue;
    }
    employees.push({
      ...base,
      openingYtd,
      hourlyWeeks: weeks,
      earnings: employeeAdjustments,
    });
  }

  const workweekIds = workweekIdsForPeriod(splitSettings);
  return {
    input: {
      checkDate: args.checkDate,
      settings: setup ?? { sutRateBp: 0, swhMethod: "annualized", payFrequency: "biweekly" },
      employees,
    },
    settingsSnapshot,
    hoursSource: args.hoursSource,
    shifts,
    tips,
    adjustments,
    workweekIds,
    errors,
    warnings,
  };
}

export function previewPayrollRun(built: BuildRunInputResult): PayrollRunResult {
  const result = computePayrollRun(built.input);
  return {
    ...result,
    errors: [...built.errors, ...result.errors],
    warnings: [...built.warnings, ...result.warnings],
  };
}

export type CanApproveResult = { ok: true } | { ok: false; reasons: string[] };

export function canApprove(result: PayrollRunResult): CanApproveResult {
  const reasons: string[] = [];
  if (result.errors.length > 0) {
    reasons.push("The run has errors and cannot be approved, paid, exported, or saved as final");
  }
  if (result.checks.length === 0) {
    reasons.push("The run has no checks");
  }
  for (const check of result.checks) {
    if (check.netCents < 0) {
      reasons.push(`Employee ${check.employeeId} has a negative net`);
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function toDraftPayload(
  result: PayrollRunResult,
  meta: {
    periodStart: string;
    periodEnd: string;
    hoursSource: HoursSource;
    settings: PayrollRunSettingsSnapshot;
    inputs: PayrollRunInputsSnapshot;
    notes?: string | null;
    ytdBasisRevision: string;
  },
): { run: PayrollRunDraftPayload; checks: PayrollCheckDraftPayload[] } {
  return {
    run: {
      period_start: meta.periodStart,
      period_end: meta.periodEnd,
      check_date: result.checkDate,
      hours_source: meta.hoursSource,
      schedule_id: result.scheduleId,
      settings: meta.settings,
      inputs: meta.inputs,
      gross_cents: result.payrollGrossCents,
      employee_withholdings_cents: result.employeeDeductionCents,
      net_cents: result.netPayCents,
      employer_taxes_cents: result.employerTaxCents,
      employer_cost_cents: result.employerCostCents,
      cash_gross_cents: result.cashTotalCents,
      errors: result.errors,
      warnings: result.warnings,
      notes: meta.notes ?? null,
      ytd_basis_revision: meta.ytdBasisRevision,
    },
    checks: result.checks.map((check) => ({
      employee_id: check.employeeId,
      pay_type: check.payType,
      gross_cents: check.grossCents,
      deductions_cents: check.employeeDeductionCents,
      net_cents: check.netCents,
      employer_tax_cents: check.employerTaxCents,
      closing_ytd: check.closingYtd,
      earnings: check.earnings.map((line) => ({
        kind: line.kind,
        restaurant_id: asUuidOrNull(line.classId),
        position: line.positionId,
        workweek_id: line.workweekId,
        hours_hundredths: line.hoursHundredths,
        rate_cents: line.rateCents,
        amount_cents: line.amountCents,
        reason: line.reason,
      })),
      taxes: [
        ...check.employeeWithholdings.map((line) => ({
          side: "employee" as const,
          tax_code: line.code,
          taxable_cents: line.taxableCents,
          amount_cents: line.amountCents,
        })),
        ...check.employerTaxes.map((line) => ({
          side: "employer" as const,
          tax_code: line.code,
          taxable_cents: line.taxableCents,
          amount_cents: line.amountCents,
        })),
      ],
    })),
  };
}

export function taxYearFromCheckDate(checkDate: string): number {
  return Number(checkDate.slice(0, 4));
}

export function historyFromStoredRuns(
  runs: ReadonlyArray<{
    check_date: string;
    status: PayrollRunStatus;
    payroll_checks: ReadonlyArray<{
      employee_id: string;
      gross_cents: number;
      payroll_check_taxes: ReadonlyArray<{
        side: "employee" | "employer";
        tax_code: TaxCode;
        taxable_cents: number;
        amount_cents: number;
      }>;
    }>;
  }>,
  beforeCheckDate: string,
  taxYear: number,
): { taxes: YtdPriorCheckTax[]; gross: YtdPriorGross[] } {
  const taxes: YtdPriorCheckTax[] = [];
  const gross: YtdPriorGross[] = [];
  for (const run of runs) {
    const checkDate = run.check_date.slice(0, 10);
    if (checkDate >= beforeCheckDate) continue;
    if (Number(checkDate.slice(0, 4)) !== taxYear) continue;
    for (const check of run.payroll_checks) {
      gross.push({
        employeeId: check.employee_id,
        taxYear,
        checkDate,
        status: run.status,
        grossCents: check.gross_cents,
      });
      for (const tax of check.payroll_check_taxes) {
        taxes.push({
          employeeId: check.employee_id,
          taxYear,
          checkDate,
          status: run.status,
          side: tax.side,
          taxCode: tax.tax_code,
          taxableCents: tax.taxable_cents,
          amountCents: tax.amount_cents,
        });
      }
    }
  }
  return { taxes, gross };
}

export const TAX_CODES_FOR_YTD: readonly TaxCode[] = ALL_TAX_CODES;

export function isRunInputsSnapshot(value: unknown): value is PayrollRunInputsSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as PayrollRunInputsSnapshot;
  return typeof row.checkDate === "string" && Array.isArray(row.employees) && Boolean(row.settings);
}

function closingFromUnknown(value: unknown): ClosingYtd {
  const row = value && typeof value === "object" ? (value as ClosingYtd) : null;
  return {
    grossCents: row?.grossCents ?? 0,
    taxableCents: { ...EMPTY_TAX_YTD, ...row?.taxableCents },
    withheldCents: { ...EMPTY_TAX_YTD, ...row?.withheldCents },
    employerWithheldCents: { ...EMPTY_TAX_YTD, ...row?.employerWithheldCents },
  };
}

function summarizeStoredEarnings(checks: PayrollCheck[]): KindHoursAmount[] {
  const order: EarningsKind[] = ["regular", "overtime", "salary", "tips", "min_wage_makeup", "adjustment"];
  const byKind = new Map<EarningsKind, { hoursHundredths: number; amountCents: number }>();
  for (const kind of order) byKind.set(kind, { hoursHundredths: 0, amountCents: 0 });
  for (const check of checks) {
    for (const line of check.earnings) {
      const current = byKind.get(line.kind) ?? { hoursHundredths: 0, amountCents: 0 };
      current.hoursHundredths += line.hoursHundredths;
      current.amountCents += line.amountCents;
      byKind.set(line.kind, current);
    }
  }
  return order
    .map((kind) => ({ kind, ...(byKind.get(kind) ?? { hoursHundredths: 0, amountCents: 0 }) }))
    .filter((row) => row.hoursHundredths !== 0 || row.amountCents !== 0);
}

function summarizeStoredTaxes(checks: PayrollCheck[], side: "employee" | "employer"): CodeAmount[] {
  const totals = new Map<TaxCode, number>();
  for (const check of checks.filter((row) => row.payType === "payroll")) {
    const lines = side === "employee" ? check.employeeWithholdings : check.employerTaxes;
    for (const line of lines) {
      totals.set(line.code, (totals.get(line.code) ?? 0) + line.amountCents);
    }
  }
  return ALL_TAX_CODES.map((code) => ({ code, amountCents: totals.get(code) ?? 0 })).filter(
    (row) => row.amountCents !== 0,
  );
}

function storedClassCosts(checks: PayrollCheck[]): ClassCost[] {
  const totals = new Map<string, { grossCents: number; employerTaxCents: number }>();
  for (const check of checks) {
    const weights = check.earnings.map((line) => ({ id: line.classId ?? "", weight: line.amountCents }));
    const allocated = allocateLargestRemainder(check.employerTaxCents, weights);
    const classGross = new Map<string, number>();
    for (const line of check.earnings) {
      const id = line.classId ?? "";
      classGross.set(id, (classGross.get(id) ?? 0) + line.amountCents);
    }
    for (const id of new Set([...classGross.keys(), ...allocated.keys()])) {
      const current = totals.get(id) ?? { grossCents: 0, employerTaxCents: 0 };
      current.grossCents += classGross.get(id) ?? 0;
      current.employerTaxCents += allocated.get(id) ?? 0;
      totals.set(id, current);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classId, row]) => ({
      classId,
      grossCents: row.grossCents,
      employerTaxCents: row.employerTaxCents,
      employerCostCents: row.grossCents + row.employerTaxCents,
    }));
}

function resultFromLedger(run: PayrollRunWithChecks): PayrollRunResult {
  const stored = storedRunMessages(run);
  const checks: PayrollCheck[] = [...run.payroll_checks]
    .sort((a, b) => a.employee_id.localeCompare(b.employee_id))
    .map((row) => {
      const earnings: EarningsLine[] = row.payroll_check_earnings.map((line) => ({
        kind: line.kind,
        classId: line.restaurant_id,
        positionId: line.position,
        hoursHundredths: line.hours_hundredths,
        rateCents: line.rate_cents,
        amountCents: line.amount_cents,
        workweekId: line.workweek_id,
        reason: line.reason,
      }));
      const employeeWithholdings: TaxLine[] = row.payroll_check_taxes
        .filter((line) => line.side === "employee")
        .map((line) => ({ code: line.tax_code, taxableCents: line.taxable_cents, amountCents: line.amount_cents }));
      const employerTaxes: TaxLine[] = row.payroll_check_taxes
        .filter((line) => line.side === "employer")
        .map((line) => ({ code: line.tax_code, taxableCents: line.taxable_cents, amountCents: line.amount_cents }));
      return {
        employeeId: row.employee_id,
        checkDate: run.check_date.slice(0, 10),
        taxYear: Number(run.check_date.slice(0, 4)),
        scheduleId: run.schedule_id,
        payType: row.pay_type,
        earnings,
        employeeWithholdings,
        employerTaxes,
        grossCents: row.gross_cents,
        employeeDeductionCents: row.deductions_cents,
        netCents: row.net_cents,
        employerTaxCents: row.employer_tax_cents,
        employerCostCents: row.gross_cents + row.employer_tax_cents,
        closingYtd: closingFromUnknown(row.closing_ytd),
        warnings: [],
        errors: [],
      };
    });
  const payrollChecks = checks.filter((check) => check.payType === "payroll");
  const cashChecks = checks.filter((check) => check.payType === "cash");
  return {
    checkDate: run.check_date.slice(0, 10),
    scheduleId: run.schedule_id,
    checks,
    earningsByKind: summarizeStoredEarnings(checks),
    employeeWithholdingsByCode: summarizeStoredTaxes(checks, "employee"),
    employerTaxesByCode: summarizeStoredTaxes(checks, "employer"),
    liabilities: computePayrollLiabilities(payrollChecks),
    payrollGrossCents: run.gross_cents,
    employeeDeductionCents: run.employee_withholdings_cents,
    netPayCents: run.net_cents,
    employerTaxCents: run.employer_taxes_cents,
    employerCostCents: run.employer_cost_cents,
    cashTotalCents: run.cash_gross_cents,
    classCosts: storedClassCosts(payrollChecks),
    cashClassCosts: storedClassCosts(cashChecks),
    warnings: stored.warnings,
    errors: stored.errors,
  };
}

export function resultFromStoredRun(run: PayrollRunWithChecks): PayrollRunResult {
  if (run.status === "draft" && isRunInputsSnapshot(run.inputs)) {
    const recomputed = computePayrollRun({
      checkDate: run.inputs.checkDate,
      settings: run.inputs.settings,
      employees: run.inputs.employees,
    });
    const stored = storedRunMessages(run);
    return {
      ...recomputed,
      errors: uniqueMessages([...stored.errors, ...recomputed.errors]),
      warnings: uniqueMessages([...stored.warnings, ...recomputed.warnings]),
    };
  }
  return resultFromLedger(run);
}
