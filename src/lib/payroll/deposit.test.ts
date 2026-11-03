import { describe, expect, it } from "vitest";
import { depositSummary, type DepositCheckInput } from "./deposit";

function check(partial: Partial<DepositCheckInput> & Pick<DepositCheckInput, "employeeId">): DepositCheckInput {
  return {
    payType: "payroll",
    netCents: 0,
    employeeDeductionCents: 0,
    employerTaxCents: 0,
    ...partial,
  };
}

describe("depositSummary", () => {
  it("groups net by payment method and treats cash pay_type as cash", () => {
    const summary = depositSummary({
      taxesViaProvider: true,
      profiles: [
        { employee_id: "e-ach", payment_method: "ach" },
        { employee_id: "e-check", payment_method: "check" },
        { employee_id: "e-cash-method", payment_method: "cash" },
        { employee_id: "e-cash-pay", payment_method: "ach", pay_type: "cash" },
        { employee_id: "e-missing" },
      ],
      checks: [
        check({ employeeId: "e-ach", netCents: 10_000, employeeDeductionCents: 1_000, employerTaxCents: 500 }),
        check({ employeeId: "e-check", netCents: 4_000, employeeDeductionCents: 200, employerTaxCents: 100 }),
        check({ employeeId: "e-cash-method", netCents: 2_000 }),
        check({
          employeeId: "e-cash-pay",
          payType: "cash",
          netCents: 3_000,
          employeeDeductionCents: 0,
          employerTaxCents: 0,
        }),
        check({ employeeId: "e-missing", netCents: 1_500, employeeDeductionCents: 50, employerTaxCents: 25 }),
      ],
    });

    expect(summary.netByMethod).toEqual({
      achCents: 10_000,
      checkCents: 4_000,
      cashCents: 5_000,
      unassignedCents: 1_500,
    });
    expect(summary.employeeTaxesCents).toBe(1_250);
    expect(summary.employerTaxesCents).toBe(625);
    expect(summary.providerFundingCents).toBe(10_000 + 4_000 + 1_500 + 1_250 + 625);
  });

  it("omits employee and employer taxes from provider funding when taxes are not via the provider", () => {
    const summary = depositSummary({
      taxesViaProvider: false,
      profiles: [{ employee_id: "e-ach", payment_method: "ach" }],
      checks: [check({ employeeId: "e-ach", netCents: 8_000, employeeDeductionCents: 900, employerTaxCents: 400 })],
    });
    expect(summary.employeeTaxesCents).toBe(900);
    expect(summary.employerTaxesCents).toBe(400);
    expect(summary.providerFundingCents).toBe(8_000);
  });
});
