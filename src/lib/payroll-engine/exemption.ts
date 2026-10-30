import type { PrTaxSchedule } from "./data";
import type { Cents, ExemptionInput, PersonalExemptionStatus } from "./types";

export type ComputedExemption = {
  annualCents: Cents;
  biweeklyCents: Cents;
  allowanceCount: number;
};

function personalAmounts(status: PersonalExemptionStatus, schedule: PrTaxSchedule) {
  switch (status) {
    case "none":
      return schedule.exemption.personalNone;
    case "single":
    case "married_claiming_half":
    case "optional_computation":
      return schedule.exemption.personalSingleOrHalfOrOptional;
    case "married_claiming_all":
      return schedule.exemption.personalMarriedAll;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled personal exemption status: ${exhaustive}`);
    }
  }
}

export function deductionAllowanceCount(deductionCents: Cents, schedule: PrTaxSchedule): number {
  const unit = schedule.exemption.allowanceUnitCents;
  const extraRemainder = schedule.exemption.allowanceExtraRemainderCents;
  const units = Math.floor(Math.max(0, deductionCents) / unit);
  const remainder = Math.max(0, deductionCents) % unit;
  return units + (remainder > extraRemainder ? 1 : 0);
}

export function computeExemption(input: ExemptionInput | undefined, schedule: PrTaxSchedule): ComputedExemption {
  const personal = input?.personal ?? "none";
  const base = personalAmounts(personal, schedule);
  const dependents = input?.dependents ?? 0;
  const reducedDependents = input?.reducedDependents ?? 0;
  const allowanceCount = deductionAllowanceCount(input?.deductionCents ?? 0, schedule);

  let annualCents = base.annualCents;
  let biweeklyCents = base.biweeklyCents;

  if (input?.veteran) {
    annualCents += schedule.exemption.veteran.annualCents;
    biweeklyCents += schedule.exemption.veteran.biweeklyCents;
  }

  annualCents += dependents * schedule.exemption.dependent.annualCents;
  biweeklyCents += dependents * schedule.exemption.dependent.biweeklyCents;
  annualCents += reducedDependents * schedule.exemption.reducedDependent.annualCents;
  biweeklyCents += reducedDependents * schedule.exemption.reducedDependent.biweeklyCents;
  annualCents += allowanceCount * schedule.exemption.allowance.annualCents;
  biweeklyCents += allowanceCount * schedule.exemption.allowance.biweeklyCents;

  if (input?.annualExemptionOverrideCents !== undefined) {
    annualCents = input.annualExemptionOverrideCents;
  }
  if (input?.biweeklyExemptionOverrideCents !== undefined) {
    biweeklyCents = input.biweeklyExemptionOverrideCents;
  }

  return { annualCents, biweeklyCents, allowanceCount };
}
