import { describe, expect, it } from "vitest";
import { PR_2026 } from "./data";
import { computeExemption } from "./exemption";
import {
  additionalMedicareTaxable,
  annualSwhTaxCents,
  computeAnnualizedSwh,
  computeBiweeklyTableSwh,
  computeSwh,
} from "./withholding";

describe("SWH annualized brackets", () => {
  it("annual taxable exactly 25000.00 uses 7% − 630 (over < amt ≤ up to)", () => {
    expect(annualSwhTaxCents(2_500_000, PR_2026)).toBe(112_000);
    const periodGrossCents = 100_000;
    const annualExemptionCents = periodGrossCents * 26 - 2_500_000;
    expect(annualExemptionCents).toBe(100_000);
    expect(
      computeAnnualizedSwh({
        periodGrossCents,
        annualExemptionCents,
        additionalWithholdingCents: 0,
        periods: 26,
        schedule: PR_2026,
      }),
    ).toBe(4_308);
  });

  it("annual taxable 25001.00 uses 14% − 2380 = 1120.14, not 7%", () => {
    expect(annualSwhTaxCents(2_500_100, PR_2026)).toBe(112_014);
  });
});

describe("SWH biweekly table boundaries", () => {
  it("w exactly 346.20 → 0", () => {
    expect(
      computeBiweeklyTableSwh({
        periodGrossCents: 34_620,
        biweeklyExemptionCents: 0,
        additionalWithholdingCents: 0,
        schedule: PR_2026,
      }),
    ).toBe(0);
  });

  it("w 346.21 → 7% × 346.21 − 24.20 = 0.0347 → 0.03", () => {
    expect(
      computeBiweeklyTableSwh({
        periodGrossCents: 34_621,
        biweeklyExemptionCents: 0,
        additionalWithholdingCents: 0,
        schedule: PR_2026,
      }),
    ).toBe(3);
  });
});

describe("young worker SWH", () => {
  it("is 0 while closing YTD wages stay at or under 40000", () => {
    const swh = computeSwh(
      {
        periodGrossCents: 100_000,
        method: "annualized",
        payFrequency: "biweekly",
        exemption: computeExemption({ personal: "none" }, PR_2026),
        additionalWithholdingCents: 0,
        youngWorkerExempt: true,
        openingYtdGrossCents: 3_900_000,
      },
      PR_2026,
    );
    expect(swh).toBe(0);
  });
});

describe("additional Medicare", () => {
  it("taxable is the slice of this check that crosses 200000", () => {
    expect(additionalMedicareTaxable(132_667, 19_900_000, 20_000_000)).toBe(32_667);
  });
});
