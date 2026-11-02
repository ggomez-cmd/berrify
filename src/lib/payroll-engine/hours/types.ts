import type { HourlyWeekInput } from "../types";

export type HoursSource = "time_clock" | "clover";

export type BreakKind = "meal" | "rest" | "other";

export type ShiftBreak = {
  startedAt: string;
  endedAt: string;
  type: BreakKind;
  paid: boolean;
};

export type WorkedShift = {
  id: string;
  employeeId: string;
  positionKey: string;
  classId: string;
  startedAt: string;
  endedAt: string;
  breaks: ShiftBreak[];
  source: HoursSource;
  /** Paid time the source reported for this punch (Clover's "Total paid hours"), when it has one. */
  reportedWorkedSeconds?: number;
};

export type TimeEntryRow = {
  id: string;
  employee_id: string;
  restaurant_id: string;
  position: string;
  started_at: string;
  ended_at: string;
};

export type TimeBreakRow = {
  time_entry_id: string;
  started_at: string;
  ended_at: string;
  break_type: BreakKind;
  paid: boolean;
};

export type DailyWindowMode = "rolling_24h" | "calendar_day" | "clock_in_day";

export type PunchRounding = "none" | "hundredth_hour";

export type MealDeductionPolicy = {
  afterSeconds: number;
  deductSeconds: number;
};

export type HoursPolicy = {
  timeZone: string;
  punchRounding?: PunchRounding;
  mealDeduction?: MealDeductionPolicy | null;
};

export type LunchDeduction = {
  employeeId: string;
  ymd: string;
  seconds: number;
};

export type HoursPolicyResult = {
  shifts: WorkedShift[];
  lunchDeductions: LunchDeduction[];
  warnings: string[];
  errors: string[];
};

export type HoursSplitSettings = {
  timeZone: string;
  workweekStartDow: number;
  workweekStartTime: string;
  dailyWindow: DailyWindowMode;
  dailyLimitSeconds?: number;
  weeklyLimitSeconds?: number;
  periodStart: string;
  periodEnd: string;
};

export type ShiftAllocation = {
  shiftId: string;
  workweekId: string;
  regularSeconds: number;
  dailyOtSeconds: number;
  weeklyOtSeconds: number;
  payable: boolean;
};

export type HoursBucket = {
  employeeId: string;
  workweekId: string;
  positionKey: string;
  classId: string;
  regularSeconds: number;
  dailyOtSeconds: number;
  weeklyOtSeconds: number;
};

export type HoursSplitResult = {
  allocations: ShiftAllocation[];
  payableBuckets: HoursBucket[];
  lookbackBuckets: HoursBucket[];
  warnings: string[];
  errors: string[];
};

export type PositionRate = {
  employeeId: string;
  positionKey: string;
  rateCents: number;
  effectiveFrom: string;
};

export type WeekTips = {
  employeeId: string;
  workweekId: string;
  tipsCents: number;
};

export type HourlyWeeksResult = {
  weeks: Map<string, HourlyWeekInput[]>;
  warnings: string[];
  errors: string[];
};

export type MealFlagCode = "meal_not_started_by_5h" | "meal_too_short";

export type MealBreakRules = {
  mealMinSeconds: number;
  mealStartByWorkedSeconds: number;
  waiveIfShiftAtMostSeconds: number | null;
};

export type MealBreakFlag = {
  shiftId: string;
  employeeId: string;
  code: MealFlagCode;
  atWorkedSeconds: number;
};

export type CloverNameMapping = {
  employeeId: string;
  positionKey: string;
  classId: string;
};

export type CloverParseInput = {
  csv: string;
  timeZone: string;
  mapping: Record<string, CloverNameMapping>;
  ignore: string[];
};

export type CloverPeriod = {
  start: string;
  end: string;
};

export type CloverNameHours = {
  name: string;
  hoursHundredths: number;
};

export type CloverReconciliation = {
  name: string;
  parsedHoursHundredths: number;
  cloverHoursHundredths: number;
  warning: boolean;
};

export type CloverParseReport = {
  unmatchedNames: string[];
  ignored: CloverNameHours[];
  reconciliations: CloverReconciliation[];
  grandParsedHoursHundredths: number;
  grandCloverHoursHundredths: number | null;
  warnings: string[];
  errors: string[];
};

export type CloverParseResult = {
  shifts: WorkedShift[];
  period: CloverPeriod | null;
  report: CloverParseReport;
};
