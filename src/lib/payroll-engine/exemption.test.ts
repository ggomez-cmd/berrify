import { describe, expect, it } from "vitest";
import { PR_2026 } from "./data";
import { computeExemption, deductionAllowanceCount } from "./exemption";

describe("exemption computation", () => {
  it("single + 2 dependents + veteran = 3500 + 5000 + 1500 = 10000 annual", () => {
    const exemption = computeExemption(
      { personal: "single", dependents: 2, veteran: true },
      PR_2026,
    );
    expect(exemption.annualCents).toBe(1_000_000);
    expect(exemption.biweeklyCents).toBe(13_500 + 9_600 * 2 + 5_750);
  });

  it("married claiming all is 7000 / 270", () => {
    const exemption = computeExemption({ personal: "married_claiming_all" }, PR_2026);
    expect(exemption.annualCents).toBe(700_000);
    expect(exemption.biweeklyCents).toBe(27_000);
  });

  it("allowance rounding: 125000c / 50000 = 2 rem 25000, rem not > 25000 → 2", () => {
    expect(deductionAllowanceCount(125_000, PR_2026)).toBe(2);
  });

  it("allowance rounding: 125001c rem 25001 > 25000 → 3", () => {
    expect(deductionAllowanceCount(125_001, PR_2026)).toBe(3);
  });

  it("each allowance adds 500 annual / 19 biweekly", () => {
    const exemption = computeExemption(
      { personal: "none", deductionCents: 125_001 },
      PR_2026,
    );
    expect(exemption.allowanceCount).toBe(3);
    expect(exemption.annualCents).toBe(150_000);
    expect(exemption.biweeklyCents).toBe(5_700);
  });

  it("honors annualExemptionOverride", () => {
    const exemption = computeExemption(
      { personal: "single", annualExemptionOverrideCents: 850_000 },
      PR_2026,
    );
    expect(exemption.annualCents).toBe(850_000);
  });
});
