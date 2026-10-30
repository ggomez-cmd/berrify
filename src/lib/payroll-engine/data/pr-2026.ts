import type { BasisPoints, Cents } from "../types";

export type AnnualSwhBracket = {
  overCents: Cents;
  upToCents: Cents | null;
  rateBp: BasisPoints;
  subtractionCents: Cents;
};

export type BiweeklySwhBracket = {
  overCents: Cents;
  rateBp: BasisPoints;
  subtractionCents: Cents;
};

export type ExemptionAmounts = {
  annualCents: Cents;
  biweeklyCents: Cents;
};

export type PrTaxSchedule = {
  id: string;
  effectiveFrom: string;
  payPeriodsPerYear: {
    biweekly: number;
  };
  employee: {
    oasdiRateBp: BasisPoints;
    oasdiWageBaseCents: Cents;
    medRateBp: BasisPoints;
    additionalMedRateBp: BasisPoints;
    additionalMedThresholdCents: Cents;
    dieRateBp: BasisPoints;
    dieWageBaseCents: Cents;
  };
  employer: {
    oasdiRateBp: BasisPoints;
    oasdiWageBaseCents: Cents;
    medRateBp: BasisPoints;
    futRateBp: BasisPoints;
    futWageBaseCents: Cents;
    sutWageBaseCents: Cents;
    dieRateBp: BasisPoints;
    dieWageBaseCents: Cents;
    fseAmountCents: Cents;
  };
  swh: {
    youngWorkerThresholdCents: Cents;
    annualBrackets: readonly AnnualSwhBracket[];
    biweeklyZeroAtOrBelowCents: Cents;
    biweeklyBrackets: readonly BiweeklySwhBracket[];
  };
  exemption: {
    personalNone: ExemptionAmounts;
    personalSingleOrHalfOrOptional: ExemptionAmounts;
    personalMarriedAll: ExemptionAmounts;
    veteran: ExemptionAmounts;
    dependent: ExemptionAmounts;
    reducedDependent: ExemptionAmounts;
    allowance: ExemptionAmounts;
    allowanceUnitCents: Cents;
    allowanceExtraRemainderCents: Cents;
  };
  wage: {
    minimumHourlyCents: Cents;
    minCashWageCents: Cents;
    maxTipCreditCents: Cents;
  };
  defaults: {
    dailyOtMultiplierPpm: number;
    weeklyOtMultiplierPpm: number;
  };
};

export const PR_2026: PrTaxSchedule = {
  id: "pr-2026",
  effectiveFrom: "2026-01-01",
  payPeriodsPerYear: {
    biweekly: 26,
  },
  employee: {
    oasdiRateBp: 620,
    oasdiWageBaseCents: 18_450_000,
    medRateBp: 145,
    additionalMedRateBp: 90,
    additionalMedThresholdCents: 20_000_000,
    dieRateBp: 30,
    dieWageBaseCents: 900_000,
  },
  employer: {
    oasdiRateBp: 620,
    oasdiWageBaseCents: 18_450_000,
    medRateBp: 145,
    futRateBp: 60,
    futWageBaseCents: 700_000,
    sutWageBaseCents: 700_000,
    dieRateBp: 30,
    dieWageBaseCents: 900_000,
    fseAmountCents: 0,
  },
  swh: {
    youngWorkerThresholdCents: 4_000_000,
    annualBrackets: [
      { overCents: 0, upToCents: 900_000, rateBp: 0, subtractionCents: 0 },
      { overCents: 900_000, upToCents: 2_500_000, rateBp: 700, subtractionCents: 63_000 },
      { overCents: 2_500_000, upToCents: 4_150_000, rateBp: 1400, subtractionCents: 238_000 },
      { overCents: 4_150_000, upToCents: 6_150_000, rateBp: 2500, subtractionCents: 694_500 },
      { overCents: 6_150_000, upToCents: null, rateBp: 3300, subtractionCents: 1_186_500 },
    ],
    biweeklyZeroAtOrBelowCents: 34_620,
    biweeklyBrackets: [
      { overCents: 34_620, rateBp: 700, subtractionCents: 2_420 },
      { overCents: 96_150, rateBp: 1400, subtractionCents: 9_150 },
      { overCents: 159_620, rateBp: 2500, subtractionCents: 26_710 },
      { overCents: 236_540, rateBp: 3300, subtractionCents: 45_630 },
    ],
  },
  exemption: {
    personalNone: { annualCents: 0, biweeklyCents: 0 },
    personalSingleOrHalfOrOptional: { annualCents: 350_000, biweeklyCents: 13_500 },
    personalMarriedAll: { annualCents: 700_000, biweeklyCents: 27_000 },
    veteran: { annualCents: 150_000, biweeklyCents: 5_750 },
    dependent: { annualCents: 250_000, biweeklyCents: 9_600 },
    reducedDependent: { annualCents: 125_000, biweeklyCents: 4_800 },
    allowance: { annualCents: 50_000, biweeklyCents: 1_900 },
    allowanceUnitCents: 50_000,
    allowanceExtraRemainderCents: 25_000,
  },
  wage: {
    minimumHourlyCents: 1_050,
    minCashWageCents: 213,
    maxTipCreditCents: 837,
  },
  defaults: {
    dailyOtMultiplierPpm: 1_500_000,
    weeklyOtMultiplierPpm: 1_500_000,
  },
};
