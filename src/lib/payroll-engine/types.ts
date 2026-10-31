export type Cents = number;
export type HoursHundredths = number;
export type BasisPoints = number;
export type PartsPerMillion = number;

export type EarningsKind =
  | "regular"
  | "overtime"
  | "tips"
  | "salary"
  | "min_wage_makeup"
  | "adjustment";

export type EmployeePayType = "payroll" | "cash";

export type SwhMethod = "annualized" | "biweekly_table";

export type PayFrequency = "biweekly";

export type TaxCode =
  | "DIE"
  | "FED-ADD-MED"
  | "FED-FUT"
  | "FED-MED"
  | "FED-OASDI"
  | "FSE"
  | "SUT"
  | "SWH";

export type PersonalExemptionStatus =
  | "none"
  | "single"
  | "married_claiming_half"
  | "married_claiming_all"
  | "optional_computation";

export type TaxYtd = {
  taxableCents: Cents;
  withheldCents: Cents;
};

export type OpeningYtd = {
  grossCents: Cents;
  taxableCents: Partial<Record<TaxCode, Cents>>;
  withheldCents: Partial<Record<TaxCode, Cents>>;
  employerWithheldCents?: Partial<Record<TaxCode, Cents>>;
};

export type ClosingYtd = {
  grossCents: Cents;
  taxableCents: Record<TaxCode, Cents>;
  withheldCents: Record<TaxCode, Cents>;
  employerWithheldCents: Record<TaxCode, Cents>;
};

export type ExemptionInput = {
  personal: PersonalExemptionStatus;
  veteran?: boolean;
  dependents?: number;
  reducedDependents?: number;
  deductionCents?: Cents;
  annualExemptionOverrideCents?: Cents;
  biweeklyExemptionOverrideCents?: Cents;
};

export type EarningsLineInput = {
  kind: EarningsKind;
  classId?: string | null;
  positionId?: string | null;
  hoursHundredths?: HoursHundredths;
  rateCents?: Cents;
  amountCents?: Cents;
  workweekId?: string | null;
  reason?: string | null;
};

export type HourlyWeekInput = {
  workweekId: string;
  classId?: string | null;
  positionId?: string | null;
  rateCents: Cents;
  regularHoursHundredths: HoursHundredths;
  dailyOtHoursHundredths?: HoursHundredths;
  weeklyOtHoursHundredths?: HoursHundredths;
  tipsCents?: Cents;
};

export type SalaryInput = {
  amountCents: Cents;
  days?: number;
  periodDays?: number;
  classId?: string | null;
  hoursHundredths?: HoursHundredths;
};

export type EmployeePayInput = {
  employeeId: string;
  payType: EmployeePayType;
  isTipped?: boolean;
  dailyOtMultiplierPpm?: PartsPerMillion;
  weeklyOtMultiplierPpm?: PartsPerMillion;
  youngWorkerExempt?: boolean;
  additionalWithholdingCents?: Cents;
  exemption?: ExemptionInput;
  openingYtd?: OpeningYtd;
  earnings?: EarningsLineInput[];
  hourlyWeeks?: HourlyWeekInput[];
  salary?: SalaryInput;
};

export type EmployerSettings = {
  sutRateBp: BasisPoints;
  swhMethod: SwhMethod;
  payFrequency: PayFrequency;
};

export type PayrollRunInput = {
  checkDate: string;
  settings: EmployerSettings;
  employees: EmployeePayInput[];
};

export type EarningsLine = {
  kind: EarningsKind;
  classId: string | null;
  positionId: string | null;
  hoursHundredths: HoursHundredths;
  rateCents: Cents | null;
  amountCents: Cents;
  workweekId: string | null;
  reason: string | null;
};

export type TaxLine = {
  code: TaxCode;
  taxableCents: Cents;
  amountCents: Cents;
};

export type PayrollCheck = {
  employeeId: string;
  checkDate: string;
  taxYear: number;
  scheduleId: string;
  payType: EmployeePayType;
  earnings: EarningsLine[];
  employeeWithholdings: TaxLine[];
  employerTaxes: TaxLine[];
  grossCents: Cents;
  employeeDeductionCents: Cents;
  netCents: Cents;
  employerTaxCents: Cents;
  employerCostCents: Cents;
  closingYtd: ClosingYtd;
  warnings: string[];
  errors: string[];
};

export type KindHoursAmount = {
  kind: EarningsKind;
  hoursHundredths: HoursHundredths;
  amountCents: Cents;
};

export type CodeAmount = {
  code: TaxCode;
  amountCents: Cents;
};

export type PayrollLiabilities = {
  disabilityCents: Cents;
  futaCents: Cents;
  incomeTaxWithheldCents: Cents;
  socialSecurityCents: Cents;
  unemploymentCents: Cents;
  totalCents: Cents;
};

export type ClassCost = {
  classId: string;
  grossCents: Cents;
  employerTaxCents: Cents;
  employerCostCents: Cents;
};

export type PayrollRunResult = {
  checkDate: string;
  scheduleId: string;
  checks: PayrollCheck[];
  earningsByKind: KindHoursAmount[];
  employeeWithholdingsByCode: CodeAmount[];
  employerTaxesByCode: CodeAmount[];
  liabilities: PayrollLiabilities;
  payrollGrossCents: Cents;
  employeeDeductionCents: Cents;
  netPayCents: Cents;
  employerTaxCents: Cents;
  employerCostCents: Cents;
  cashTotalCents: Cents;
  classCosts: ClassCost[];
  cashClassCosts: ClassCost[];
  warnings: string[];
  errors: string[];
};

export const EMPTY_TAX_YTD: Record<TaxCode, Cents> = {
  DIE: 0,
  "FED-ADD-MED": 0,
  "FED-FUT": 0,
  "FED-MED": 0,
  "FED-OASDI": 0,
  FSE: 0,
  SUT: 0,
  SWH: 0,
};

export const ALL_TAX_CODES: readonly TaxCode[] = [
  "DIE",
  "FED-ADD-MED",
  "FED-FUT",
  "FED-MED",
  "FED-OASDI",
  "FSE",
  "SUT",
  "SWH",
];
