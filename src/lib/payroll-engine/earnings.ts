import type { PrTaxSchedule } from "./data";
import { amountFromHoursAndRate, applyMultiplierPpm, roundHalfUpDiv, sumCents } from "./money";
import type {
  EarningsKind,
  EarningsLine,
  EarningsLineInput,
  EmployeePayInput,
  HourlyWeekInput,
} from "./types";

export type EarningsResult = {
  lines: EarningsLine[];
  warnings: string[];
  errors: string[];
};

function emptyReason(reason: string | null | undefined): boolean {
  return !reason || reason.trim().length === 0;
}

function tipCreditTaken(cashRateCents: number, schedule: PrTaxSchedule): number {
  const raw = schedule.wage.minimumHourlyCents - cashRateCents;
  return Math.min(Math.max(0, raw), schedule.wage.maxTipCreditCents);
}

export function overtimeHourlyRateCents(input: {
  isTipped: boolean;
  regularRateCents: number;
  cashRateCents: number;
  multiplierPpm: number;
  schedule: PrTaxSchedule;
}): number {
  if (input.isTipped) {
    const minWageOt = applyMultiplierPpm(input.schedule.wage.minimumHourlyCents, input.multiplierPpm);
    return Math.max(
      applyMultiplierPpm(input.cashRateCents, input.multiplierPpm),
      minWageOt - tipCreditTaken(input.cashRateCents, input.schedule),
    );
  }
  return applyMultiplierPpm(input.regularRateCents, input.multiplierPpm);
}

const PPM = 1_000_000n;

function overtimeHourlyMicroCents(input: {
  isTipped: boolean;
  rateCents: number;
  multiplierPpm: number;
  schedule: PrTaxSchedule;
}): bigint {
  const straight = BigInt(input.rateCents) * BigInt(input.multiplierPpm);
  if (!input.isTipped) return straight;
  const federal =
    BigInt(input.schedule.wage.minimumHourlyCents) * BigInt(input.multiplierPpm) -
    BigInt(tipCreditTaken(input.rateCents, input.schedule)) * PPM;
  return straight > federal ? straight : federal;
}

export function overtimeAmountCents(input: {
  isTipped: boolean;
  rateCents: number;
  multiplierPpm: number;
  hoursHundredths: number;
  schedule: PrTaxSchedule;
}): number {
  return Number(roundHalfUpDiv(BigInt(input.hoursHundredths) * overtimeHourlyMicroCents(input), 100n * PPM));
}

function lineFromInput(input: EarningsLineInput, employee: EmployeePayInput, errors: string[]): EarningsLine | null {
  if (input.kind === "adjustment" && emptyReason(input.reason)) {
    errors.push("Adjustment earnings require a non-empty reason");
    return null;
  }
  if ((input.hoursHundredths ?? 0) < 0 || (input.rateCents ?? 0) < 0) {
    errors.push(`Earnings line ${input.kind} has negative hours or rate`);
    return null;
  }
  if (input.kind !== "adjustment" && (input.amountCents ?? 0) < 0) {
    errors.push(`Earnings line ${input.kind} has a negative amount; use a reasoned adjustment`);
    return null;
  }
  if (
    input.amountCents !== undefined &&
    input.rateCents !== undefined &&
    input.hoursHundredths !== undefined &&
    input.amountCents !== amountFromHoursAndRate(input.hoursHundredths, input.rateCents)
  ) {
    errors.push(`Earnings line ${input.kind} amount does not equal hours × rate`);
    return null;
  }
  if (employee.isTipped === true) {
    if ((input.kind === "regular" || input.kind === "overtime") && (input.hoursHundredths ?? 0) > 0) {
      errors.push("Tipped hourly pay must come from hourlyWeeks so the minimum-wage test sees every hour");
      return null;
    }
    if (input.kind === "min_wage_makeup") {
      errors.push("Minimum-wage make-up is computed automatically for tipped employees");
      return null;
    }
    if (input.kind === "tips" && !input.workweekId) {
      errors.push("Tips for tipped employees need a workweekId for the weekly minimum-wage test");
      return null;
    }
  }

  const hoursHundredths = input.hoursHundredths ?? 0;
  const rateCents = input.rateCents ?? null;
  let amountCents = input.amountCents;
  if (amountCents === undefined) {
    if (rateCents === null) {
      errors.push(`Earnings line ${input.kind} is missing amountCents or rateCents`);
      return null;
    }
    amountCents = amountFromHoursAndRate(hoursHundredths, rateCents);
  }

  return {
    kind: input.kind,
    classId: input.classId ?? null,
    positionId: input.positionId ?? null,
    hoursHundredths,
    rateCents,
    amountCents,
    workweekId: input.workweekId ?? null,
    reason: input.reason ?? null,
  };
}

function invalidWeek(week: HourlyWeekInput, employee: EmployeePayInput, schedule: PrTaxSchedule): string | null {
  if (!week.workweekId || week.workweekId.trim().length === 0) {
    return "missing workweekId";
  }
  if (
    week.rateCents < 0 ||
    week.regularHoursHundredths < 0 ||
    (week.dailyOtHoursHundredths ?? 0) < 0 ||
    (week.weeklyOtHoursHundredths ?? 0) < 0 ||
    (week.tipsCents ?? 0) < 0
  ) {
    return "negative hours, rate, or tips";
  }
  if (employee.isTipped === true && week.rateCents < schedule.wage.minCashWageCents) {
    return "tipped cash rate is below the minimum cash wage";
  }
  return null;
}

function invalidMultipliers(employee: EmployeePayInput): string | null {
  for (const multiplier of [employee.dailyOtMultiplierPpm, employee.weeklyOtMultiplierPpm]) {
    if (multiplier !== undefined && multiplier < 1_000_000) {
      return "Overtime multipliers must be at least 1.0×";
    }
  }
  return null;
}

function hourlyWeekLines(week: HourlyWeekInput, employee: EmployeePayInput, schedule: PrTaxSchedule): EarningsLine[] {
  const isTipped = employee.isTipped === true;
  const cashRateCents = week.rateCents;
  const dailyMult = employee.dailyOtMultiplierPpm ?? schedule.defaults.dailyOtMultiplierPpm;
  const weeklyMult = employee.weeklyOtMultiplierPpm ?? schedule.defaults.weeklyOtMultiplierPpm;
  const lines: EarningsLine[] = [];

  const pushHourly = (
    kind: Extract<EarningsKind, "regular" | "overtime">,
    hoursHundredths: number,
    rateCents: number,
    amountCents: number,
  ) => {
    if (hoursHundredths <= 0) return;
    lines.push({
      kind,
      classId: week.classId ?? null,
      positionId: week.positionId ?? null,
      hoursHundredths,
      rateCents,
      amountCents,
      workweekId: week.workweekId,
      reason: null,
    });
  };

  pushHourly(
    "regular",
    week.regularHoursHundredths,
    week.rateCents,
    amountFromHoursAndRate(week.regularHoursHundredths, week.rateCents),
  );
  for (const [hoursHundredths, multiplierPpm] of [
    [week.dailyOtHoursHundredths ?? 0, dailyMult],
    [week.weeklyOtHoursHundredths ?? 0, weeklyMult],
  ] as const) {
    pushHourly(
      "overtime",
      hoursHundredths,
      overtimeHourlyRateCents({ isTipped, regularRateCents: week.rateCents, cashRateCents, multiplierPpm, schedule }),
      overtimeAmountCents({ isTipped, rateCents: week.rateCents, multiplierPpm, hoursHundredths, schedule }),
    );
  }
  if ((week.tipsCents ?? 0) > 0) {
    lines.push({
      kind: "tips",
      classId: week.classId ?? null,
      positionId: week.positionId ?? null,
      hoursHundredths: 0,
      rateCents: null,
      amountCents: week.tipsCents ?? 0,
      workweekId: week.workweekId,
      reason: null,
    });
  }
  return lines;
}

function salaryLine(employee: EmployeePayInput, errors: string[]): EarningsLine | null {
  const salary = employee.salary;
  if (!salary) return null;
  const prorated = salary.days !== undefined || salary.periodDays !== undefined;
  if (
    salary.amountCents < 0 ||
    (salary.hoursHundredths ?? 0) < 0 ||
    (prorated &&
      (salary.days === undefined ||
        salary.periodDays === undefined ||
        salary.days < 0 ||
        salary.periodDays <= 0 ||
        salary.days > salary.periodDays))
  ) {
    errors.push("Salary has a negative amount or hours, or invalid proration days");
    return null;
  }
  let amountCents = salary.amountCents;
  if (salary.days !== undefined && salary.periodDays !== undefined) {
    amountCents = Number(roundHalfUpDiv(BigInt(salary.amountCents) * BigInt(salary.days), BigInt(salary.periodDays)));
  }
  return {
    kind: "salary",
    classId: salary.classId ?? null,
    positionId: null,
    hoursHundredths: salary.hoursHundredths ?? 0,
    rateCents: null,
    amountCents,
    workweekId: null,
    reason: null,
  };
}

type WeekBucket = {
  classId: string | null;
  positionId: string | null;
  hoursHundredths: number;
  straightTimeCashCents: number;
  tipsCents: number;
};

function addMakeupLines(
  lines: EarningsLine[],
  employee: EmployeePayInput,
  weeks: readonly HourlyWeekInput[],
  explicitTips: readonly EarningsLine[],
  schedule: PrTaxSchedule,
): EarningsLine[] {
  if (employee.isTipped !== true) {
    return lines;
  }

  const buckets = new Map<string, WeekBucket>();
  const ensure = (workweekId: string, classId: string | null, positionId: string | null): WeekBucket => {
    const existing = buckets.get(workweekId);
    if (existing) return existing;
    const created: WeekBucket = {
      classId,
      positionId,
      hoursHundredths: 0,
      straightTimeCashCents: 0,
      tipsCents: 0,
    };
    buckets.set(workweekId, created);
    return created;
  };

  for (const week of weeks) {
    const bucket = ensure(week.workweekId, week.classId ?? null, week.positionId ?? null);
    const hours =
      week.regularHoursHundredths + (week.dailyOtHoursHundredths ?? 0) + (week.weeklyOtHoursHundredths ?? 0);
    bucket.hoursHundredths += hours;
    bucket.straightTimeCashCents += amountFromHoursAndRate(hours, week.rateCents);
    bucket.tipsCents += week.tipsCents ?? 0;
  }

  for (const line of explicitTips) {
    if (!line.workweekId) continue;
    ensure(line.workweekId, line.classId, line.positionId).tipsCents += line.amountCents;
  }

  const extra: EarningsLine[] = [];
  for (const [workweekId, bucket] of buckets) {
    if (bucket.hoursHundredths <= 0) continue;
    const required = amountFromHoursAndRate(bucket.hoursHundredths, schedule.wage.minimumHourlyCents);
    const actual = bucket.straightTimeCashCents + bucket.tipsCents;
    const shortfall = required - actual;
    if (shortfall > 0) {
      extra.push({
        kind: "min_wage_makeup",
        classId: bucket.classId,
        positionId: bucket.positionId,
        hoursHundredths: 0,
        rateCents: null,
        amountCents: shortfall,
        workweekId,
        reason: null,
      });
    }
  }
  return extra.length === 0 ? lines : [...lines, ...extra];
}

function underMinimumWarnings(employee: EmployeePayInput, lines: EarningsLine[], schedule: PrTaxSchedule): string[] {
  if (employee.isTipped) return [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  const considerRate = (rateCents: number | null) => {
    if (rateCents === null || rateCents >= schedule.wage.minimumHourlyCents || seen.has(rateCents)) {
      return;
    }
    seen.add(rateCents);
    warnings.push(
      `Employee ${employee.employeeId} has a non-tipped hourly rate below the PR minimum wage`,
    );
  };

  for (const week of employee.hourlyWeeks ?? []) {
    considerRate(week.rateCents);
  }
  for (const line of lines) {
    if (line.kind === "regular" || line.kind === "overtime") {
      considerRate(line.rateCents);
    }
  }
  return warnings;
}

export function computeEarnings(employee: EmployeePayInput, schedule: PrTaxSchedule): EarningsResult {
  const errors: string[] = [];
  const lines: EarningsLine[] = [];

  const explicitTips: EarningsLine[] = [];
  for (const input of employee.earnings ?? []) {
    const line = lineFromInput(input, employee, errors);
    if (!line) continue;
    lines.push(line);
    if (line.kind === "tips") explicitTips.push(line);
  }

  const multiplierError = invalidMultipliers(employee);
  if (multiplierError) errors.push(multiplierError);

  const weeks: HourlyWeekInput[] = [];
  for (const week of multiplierError ? [] : employee.hourlyWeeks ?? []) {
    const weekError = invalidWeek(week, employee, schedule);
    if (weekError) {
      errors.push(`Hourly week ${week.workweekId || "(no id)"}: ${weekError}`);
      continue;
    }
    weeks.push(week);
    lines.push(...hourlyWeekLines(week, employee, schedule));
  }

  const salary = salaryLine(employee, errors);
  if (salary) lines.push(salary);

  const withMakeup = addMakeupLines(lines, employee, weeks, explicitTips, schedule);
  const warnings = underMinimumWarnings(employee, withMakeup, schedule);
  return { lines: withMakeup, warnings, errors };
}

export function earningsGrossCents(lines: readonly EarningsLine[]): number {
  return sumCents(lines.map((line) => line.amountCents));
}

export function hoursByKind(lines: readonly EarningsLine[]): Record<EarningsKind, number> {
  const totals: Record<EarningsKind, number> = {
    regular: 0,
    overtime: 0,
    tips: 0,
    salary: 0,
    min_wage_makeup: 0,
    adjustment: 0,
  };
  for (const line of lines) {
    totals[line.kind] += line.hoursHundredths;
  }
  return totals;
}
