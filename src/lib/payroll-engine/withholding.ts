import type { PrTaxSchedule } from "./data";
import { applyRateBp, roundHalfUpDiv } from "./money";
import type { Cents, PayFrequency, SwhMethod } from "./types";
import { computeExemption, type ComputedExemption } from "./exemption";
import type { ExemptionInput } from "./types";

export type SwhInput = {
  periodGrossCents: Cents;
  method: SwhMethod;
  payFrequency: PayFrequency;
  exemption: ComputedExemption;
  additionalWithholdingCents: Cents;
  youngWorkerExempt: boolean;
  openingYtdGrossCents: Cents;
};

export function periodsPerYear(payFrequency: PayFrequency, schedule: PrTaxSchedule): number {
  switch (payFrequency) {
    case "biweekly":
      return schedule.payPeriodsPerYear.biweekly;
    default: {
      const exhaustive: never = payFrequency;
      throw new Error(`Unhandled pay frequency: ${exhaustive}`);
    }
  }
}

export function annualSwhTaxCents(annualTaxableCents: Cents, schedule: PrTaxSchedule): Cents {
  const taxable = Math.max(0, annualTaxableCents);
  const bracket = [...schedule.swh.annualBrackets]
    .reverse()
    .find((row) => taxable > row.overCents && (row.upToCents === null || taxable <= row.upToCents));
  if (!bracket || bracket.rateBp === 0) {
    return 0;
  }
  const raw =
    BigInt(taxable) * BigInt(bracket.rateBp) - BigInt(bracket.subtractionCents) * 10000n;
  if (raw <= 0n) {
    return 0;
  }
  return Number(roundHalfUpDiv(raw, 10000n));
}

export function computeAnnualizedSwh(input: {
  periodGrossCents: Cents;
  annualExemptionCents: Cents;
  additionalWithholdingCents: Cents;
  periods: number;
  schedule: PrTaxSchedule;
}): Cents {
  const annualWages = input.periodGrossCents * input.periods;
  const annualTaxable = Math.max(0, annualWages - input.annualExemptionCents);
  const bracket = [...input.schedule.swh.annualBrackets]
    .reverse()
    .find((row) => annualTaxable > row.overCents && (row.upToCents === null || annualTaxable <= row.upToCents));
  if (!bracket || bracket.rateBp === 0) {
    return Math.max(0, input.additionalWithholdingCents);
  }
  const raw =
    BigInt(annualTaxable) * BigInt(bracket.rateBp) - BigInt(bracket.subtractionCents) * 10000n;
  if (raw <= 0n) {
    return Math.max(0, input.additionalWithholdingCents);
  }
  const periodTax = Number(roundHalfUpDiv(raw, 10000n * BigInt(input.periods)));
  return Math.max(0, periodTax + input.additionalWithholdingCents);
}

export function computeBiweeklyTableSwh(input: {
  periodGrossCents: Cents;
  biweeklyExemptionCents: Cents;
  additionalWithholdingCents: Cents;
  schedule: PrTaxSchedule;
}): Cents {
  const wages = input.periodGrossCents - input.biweeklyExemptionCents;
  if (wages <= input.schedule.swh.biweeklyZeroAtOrBelowCents) {
    return Math.max(0, input.additionalWithholdingCents);
  }
  const bracket = [...input.schedule.swh.biweeklyBrackets]
    .reverse()
    .find((row) => wages > row.overCents);
  if (!bracket) {
    return Math.max(0, input.additionalWithholdingCents);
  }
  const raw = BigInt(wages) * BigInt(bracket.rateBp) - BigInt(bracket.subtractionCents) * 10000n;
  const tax = raw <= 0n ? 0 : Number(roundHalfUpDiv(raw, 10000n));
  return Math.max(0, tax + input.additionalWithholdingCents);
}

export function computeSwh(input: SwhInput, schedule: PrTaxSchedule): Cents {
  const closingGross = input.openingYtdGrossCents + input.periodGrossCents;
  if (input.youngWorkerExempt && closingGross <= schedule.swh.youngWorkerThresholdCents) {
    return Math.max(0, input.additionalWithholdingCents);
  }

  switch (input.method) {
    case "annualized":
      return computeAnnualizedSwh({
        periodGrossCents: input.periodGrossCents,
        annualExemptionCents: input.exemption.annualCents,
        additionalWithholdingCents: input.additionalWithholdingCents,
        periods: periodsPerYear(input.payFrequency, schedule),
        schedule,
      });
    case "biweekly_table":
      return computeBiweeklyTableSwh({
        periodGrossCents: input.periodGrossCents,
        biweeklyExemptionCents: input.exemption.biweeklyCents,
        additionalWithholdingCents: input.additionalWithholdingCents,
        schedule,
      });
    default: {
      const exhaustive: never = input.method;
      throw new Error(`Unhandled SWH method: ${exhaustive}`);
    }
  }
}

export function computeSwhFromExemptionInput(
  args: Omit<SwhInput, "exemption"> & { exemptionInput?: ExemptionInput },
  schedule: PrTaxSchedule,
): Cents {
  return computeSwh(
    {
      ...args,
      exemption: computeExemption(args.exemptionInput, schedule),
    },
    schedule,
  );
}

export function wageBaseTaxable(periodGrossCents: Cents, ytdTaxableCents: Cents, wageBaseCents: Cents | null): Cents {
  if (wageBaseCents === null) {
    return Math.max(0, periodGrossCents);
  }
  return Math.min(Math.max(0, periodGrossCents), Math.max(0, wageBaseCents - ytdTaxableCents));
}

export function additionalMedicareTaxable(
  periodMedicareWagesCents: Cents,
  ytdMedicareWagesCents: Cents,
  thresholdCents: Cents,
): Cents {
  const overThreshold = Math.max(0, ytdMedicareWagesCents + periodMedicareWagesCents - thresholdCents);
  return Math.min(Math.max(0, periodMedicareWagesCents), overThreshold);
}

export function taxOnTaxable(taxableCents: Cents, rateBp: number): Cents {
  return applyRateBp(taxableCents, rateBp);
}
