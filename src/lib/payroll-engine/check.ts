import { assertCheckDate, selectTaxSchedule, type PrTaxSchedule } from "./data";
import { computeEarnings, earningsGrossCents } from "./earnings";
import { computeExemption } from "./exemption";
import { sumCents } from "./money";
import type {
  ClosingYtd,
  EmployeePayInput,
  EmployerSettings,
  OpeningYtd,
  PayrollCheck,
  TaxCode,
  TaxLine,
} from "./types";
import { ALL_TAX_CODES, EMPTY_TAX_YTD } from "./types";
import {
  additionalMedicareTaxable,
  computeSwh,
  taxOnTaxable,
  wageBaseTaxable,
} from "./withholding";

function ytdValue(map: Partial<Record<TaxCode, number>> | undefined, code: TaxCode): number {
  return map?.[code] ?? 0;
}

function emptyClosing(opening: OpeningYtd | undefined): ClosingYtd {
  const taxableCents = { ...EMPTY_TAX_YTD };
  const withheldCents = { ...EMPTY_TAX_YTD };
  const employerWithheldCents = { ...EMPTY_TAX_YTD };
  for (const code of ALL_TAX_CODES) {
    taxableCents[code] = ytdValue(opening?.taxableCents, code);
    withheldCents[code] = ytdValue(opening?.withheldCents, code);
    employerWithheldCents[code] = ytdValue(opening?.employerWithheldCents, code);
  }
  return {
    grossCents: opening?.grossCents ?? 0,
    taxableCents,
    withheldCents,
    employerWithheldCents,
  };
}

function addYtd(
  closing: ClosingYtd,
  code: TaxCode,
  taxableCents: number,
  withheldCents: number,
  side: "employee" | "employer" | "employer_only",
): void {
  if (side !== "employer") {
    closing.taxableCents[code] += taxableCents;
  }
  if (side === "employee") {
    closing.withheldCents[code] += withheldCents;
  } else {
    closing.employerWithheldCents[code] += withheldCents;
  }
}

export function assertEmployerSettings(settings: EmployerSettings): void {
  if (!Number.isSafeInteger(settings.sutRateBp) || settings.sutRateBp < 0 || settings.sutRateBp > 10_000) {
    throw new Error(`SUT rate must be between 0 and 10000 basis points, got ${settings.sutRateBp}`);
  }
}

function isNonNegativeInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

export function taxInputErrors(employee: EmployeePayInput): string[] {
  const errors: string[] = [];
  if (!isNonNegativeInteger(employee.additionalWithholdingCents)) {
    errors.push("Additional withholding must be a non-negative amount");
  }
  const exemption = employee.exemption;
  if (
    exemption &&
    ![
      exemption.dependents,
      exemption.reducedDependents,
      exemption.deductionCents,
      exemption.annualExemptionOverrideCents,
      exemption.biweeklyExemptionOverrideCents,
    ].every(isNonNegativeInteger)
  ) {
    errors.push("Exemption counts and amounts must be non-negative");
  }
  const opening = employee.openingYtd;
  if (opening) {
    const values = [
      opening.grossCents,
      ...Object.values(opening.taxableCents),
      ...Object.values(opening.withheldCents),
      ...Object.values(opening.employerWithheldCents ?? {}),
    ];
    if (!values.every(isNonNegativeInteger)) {
      errors.push("Opening year-to-date amounts must be non-negative");
    }
  }
  return errors;
}

export function computeCheckTaxes(
  grossCents: number,
  opening: OpeningYtd | undefined,
  employee: EmployeePayInput,
  settings: EmployerSettings,
  schedule: PrTaxSchedule,
): { employeeWithholdings: TaxLine[]; employerTaxes: TaxLine[]; closingYtd: ClosingYtd } {
  const closingYtd = emptyClosing(opening);
  const exemption = computeExemption(employee.exemption, schedule);
  const oasdiTaxable = wageBaseTaxable(grossCents, ytdValue(opening?.taxableCents, "FED-OASDI"), schedule.employee.oasdiWageBaseCents);
  const medTaxable = wageBaseTaxable(grossCents, ytdValue(opening?.taxableCents, "FED-MED"), null);
  const addMedTaxable = additionalMedicareTaxable(
    medTaxable,
    ytdValue(opening?.taxableCents, "FED-MED"),
    schedule.employee.additionalMedThresholdCents,
  );
  const dieTaxable = wageBaseTaxable(grossCents, ytdValue(opening?.taxableCents, "DIE"), schedule.employee.dieWageBaseCents);
  const futTaxable = wageBaseTaxable(grossCents, ytdValue(opening?.taxableCents, "FED-FUT"), schedule.employer.futWageBaseCents);
  const sutTaxable = wageBaseTaxable(grossCents, ytdValue(opening?.taxableCents, "SUT"), schedule.employer.sutWageBaseCents);

  const oasdi = taxOnTaxable(oasdiTaxable, schedule.employee.oasdiRateBp);
  const med = taxOnTaxable(medTaxable, schedule.employee.medRateBp);
  const addMed = taxOnTaxable(addMedTaxable, schedule.employee.additionalMedRateBp);
  const die = taxOnTaxable(dieTaxable, schedule.employee.dieRateBp);
  const swh = computeSwh(
    {
      periodGrossCents: grossCents,
      method: settings.swhMethod,
      payFrequency: settings.payFrequency,
      exemption,
      additionalWithholdingCents: employee.additionalWithholdingCents ?? 0,
      youngWorkerExempt: employee.youngWorkerExempt === true,
      openingYtdGrossCents: opening?.grossCents ?? 0,
    },
    schedule,
  );

  const erOasdi = taxOnTaxable(oasdiTaxable, schedule.employer.oasdiRateBp);
  const erMed = taxOnTaxable(medTaxable, schedule.employer.medRateBp);
  const erDie = taxOnTaxable(dieTaxable, schedule.employer.dieRateBp);
  const erFut = taxOnTaxable(futTaxable, schedule.employer.futRateBp);
  const erSut = taxOnTaxable(sutTaxable, settings.sutRateBp);
  const erFse = schedule.employer.fseAmountCents;

  const employeeWithholdings: TaxLine[] = [
    { code: "DIE", taxableCents: dieTaxable, amountCents: die },
    { code: "FED-MED", taxableCents: medTaxable, amountCents: med },
    { code: "FED-OASDI", taxableCents: oasdiTaxable, amountCents: oasdi },
    { code: "SWH", taxableCents: grossCents, amountCents: swh },
  ];
  if (addMed > 0) {
    employeeWithholdings.push({ code: "FED-ADD-MED", taxableCents: addMedTaxable, amountCents: addMed });
  }

  const employerTaxes: TaxLine[] = [
    { code: "DIE", taxableCents: dieTaxable, amountCents: erDie },
    { code: "FED-FUT", taxableCents: futTaxable, amountCents: erFut },
    { code: "FED-MED", taxableCents: medTaxable, amountCents: erMed },
    { code: "FED-OASDI", taxableCents: oasdiTaxable, amountCents: erOasdi },
    { code: "FSE", taxableCents: 0, amountCents: erFse },
    { code: "SUT", taxableCents: sutTaxable, amountCents: erSut },
  ];

  closingYtd.grossCents += grossCents;
  addYtd(closingYtd, "DIE", dieTaxable, die, "employee");
  addYtd(closingYtd, "FED-MED", medTaxable, med, "employee");
  addYtd(closingYtd, "FED-OASDI", oasdiTaxable, oasdi, "employee");
  addYtd(closingYtd, "SWH", grossCents, swh, "employee");
  addYtd(closingYtd, "FED-ADD-MED", addMedTaxable, addMed, "employee");
  addYtd(closingYtd, "DIE", dieTaxable, erDie, "employer");
  addYtd(closingYtd, "FED-MED", medTaxable, erMed, "employer");
  addYtd(closingYtd, "FED-OASDI", oasdiTaxable, erOasdi, "employer");
  addYtd(closingYtd, "FED-FUT", futTaxable, erFut, "employer_only");
  addYtd(closingYtd, "SUT", sutTaxable, erSut, "employer_only");
  addYtd(closingYtd, "FSE", 0, erFse, "employer_only");

  return { employeeWithholdings, employerTaxes, closingYtd };
}

export function computeCheck(
  employee: EmployeePayInput,
  settings: EmployerSettings,
  checkDate: string,
  schedule?: PrTaxSchedule,
): PayrollCheck {
  assertCheckDate(checkDate);
  assertEmployerSettings(settings);
  const taxSchedule = schedule ?? selectTaxSchedule(checkDate);
  const earnings = computeEarnings(employee, taxSchedule);
  const grossCents = earningsGrossCents(earnings.lines);
  const identity = {
    employeeId: employee.employeeId,
    checkDate,
    taxYear: Number(checkDate.slice(0, 4)),
    scheduleId: taxSchedule.id,
  };

  const inputErrors = employee.payType === "payroll" ? taxInputErrors(employee) : [];
  if (grossCents < 0 || inputErrors.length > 0) {
    return {
      ...identity,
      payType: employee.payType,
      earnings: earnings.lines,
      employeeWithholdings: [],
      employerTaxes: [],
      grossCents,
      employeeDeductionCents: 0,
      netCents: grossCents,
      employerTaxCents: 0,
      employerCostCents: grossCents,
      closingYtd: emptyClosing(employee.openingYtd),
      warnings: earnings.warnings,
      errors: [
        ...earnings.errors,
        ...inputErrors,
        ...(grossCents < 0 ? ["Negative gross is not supported; reverse the original check instead"] : []),
      ],
    };
  }

  if (employee.payType === "cash") {
    const closingYtd = emptyClosing(employee.openingYtd);
    closingYtd.grossCents += grossCents;
    return {
      ...identity,
      payType: "cash",
      earnings: earnings.lines,
      employeeWithholdings: [],
      employerTaxes: [],
      grossCents,
      employeeDeductionCents: 0,
      netCents: grossCents,
      employerTaxCents: 0,
      employerCostCents: grossCents,
      closingYtd,
      warnings: earnings.warnings,
      errors: earnings.errors,
    };
  }

  const taxes = computeCheckTaxes(grossCents, employee.openingYtd, employee, settings, taxSchedule);
  const employeeDeductionCents = sumCents(taxes.employeeWithholdings.map((line) => line.amountCents));
  const employerTaxCents = sumCents(taxes.employerTaxes.map((line) => line.amountCents));
  return {
    ...identity,
    payType: "payroll",
    earnings: earnings.lines,
    employeeWithholdings: taxes.employeeWithholdings,
    employerTaxes: taxes.employerTaxes,
    grossCents,
    employeeDeductionCents,
    netCents: grossCents - employeeDeductionCents,
    employerTaxCents,
    employerCostCents: grossCents + employerTaxCents,
    closingYtd: taxes.closingYtd,
    warnings: earnings.warnings,
    errors: earnings.errors,
  };
}
