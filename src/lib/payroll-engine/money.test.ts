import { describe, expect, it } from "vitest";
import { amountFromHoursAndRate, applyRateBp, roundHalfUpDiv, roundHalfUpRatio } from "./money";

describe("roundHalfUpDiv", () => {
  it("rounds exact .5 cent up: 50c * 1% = 0.5 → 1", () => {
    expect(applyRateBp(50, 100)).toBe(1);
  });

  it("rounds 1.5 cents up to 2", () => {
    expect(Number(roundHalfUpDiv(3n, 2n))).toBe(2);
  });

  it("keeps 1.49 cents at 1", () => {
    expect(applyRateBp(149, 100)).toBe(1);
  });

  it("rounds 200000c * 5.4% to 10800c", () => {
    expect(applyRateBp(200_000, 540)).toBe(10_800);
  });

  it("rounds 6.07h * $8.50: 607*850/100 = 5159.5 → 5160", () => {
    expect(amountFromHoursAndRate(607, 850)).toBe(5160);
  });

  it("uses integer half-up for 255000 * 8 / 14 = 145714", () => {
    expect(roundHalfUpRatio(255_000 * 8, 14)).toBe(145_714);
  });
});
