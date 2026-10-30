import { describe, expect, it } from "vitest";
import { allocateLargestRemainder, computePayrollRun } from "./run";

describe("per-class employer tax allocation", () => {
  it("largest remainder assigns leftover cents so shares sum to the check tax", () => {
    const allocated = allocateLargestRemainder(100, [
      { id: "north", weight: 100 },
      { id: "south", weight: 200 },
    ]);
    expect(allocated.get("north")).toBe(33);
    expect(allocated.get("south")).toBe(67);
    expect((allocated.get("north") ?? 0) + (allocated.get("south") ?? 0)).toBe(100);
  });

  it("a check split across two classes allocates employer taxes exactly", () => {
    const run = computePayrollRun({
      checkDate: "2026-10-23",
      settings: { sutRateBp: 540, swhMethod: "annualized", payFrequency: "biweekly" },
      employees: [
        {
          employeeId: "X01",
          payType: "payroll",
          exemption: { personal: "none", annualExemptionOverrideCents: 0 },
          earnings: [
            { kind: "regular", amountCents: 100_000, classId: "north" },
            { kind: "regular", amountCents: 200_000, classId: "south" },
          ],
        },
      ],
    });
    const check = run.checks[0];
    expect(check).toBeDefined();
    const north = run.classCosts.find((row) => row.classId === "north");
    const south = run.classCosts.find((row) => row.classId === "south");
    expect(north?.grossCents).toBe(100_000);
    expect(south?.grossCents).toBe(200_000);
    expect((north?.employerTaxCents ?? 0) + (south?.employerTaxCents ?? 0)).toBe(check?.employerTaxCents);
    expect(run.classCosts.reduce((sum, row) => sum + row.employerTaxCents, 0)).toBe(run.employerTaxCents);
  });
});
