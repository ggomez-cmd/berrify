import type { EmployeePayType, PayrollCheck } from "../payroll-engine/types";
import type { PayrollEmployeeProfileRow } from "../types";

export type DepositPaymentMethod = "ach" | "check" | "cash" | "unassigned";

export type DepositMethodTotals = {
  achCents: number;
  checkCents: number;
  cashCents: number;
  unassignedCents: number;
};

export type PayrollDepositSummary = {
  netByMethod: DepositMethodTotals;
  employeeTaxesCents: number;
  employerTaxesCents: number;
  providerFundingCents: number;
};

export type DepositCheckInput = Pick<
  PayrollCheck,
  "employeeId" | "payType" | "netCents" | "employeeDeductionCents" | "employerTaxCents"
>;

export type DepositProfileInput = Pick<PayrollEmployeeProfileRow, "employee_id"> & {
  payment_method?: PayrollEmployeeProfileRow["payment_method"];
  pay_type?: EmployeePayType;
};

function methodFor(
  check: DepositCheckInput,
  profile: DepositProfileInput | undefined,
): DepositPaymentMethod {
  if (check.payType === "cash") return "cash";
  const method = profile?.payment_method;
  if (method === "ach" || method === "check" || method === "cash") return method;
  return "unassigned";
}

export function depositSummary(input: {
  checks: readonly DepositCheckInput[];
  profiles: readonly DepositProfileInput[];
  taxesViaProvider: boolean;
}): PayrollDepositSummary {
  const profileById = new Map(input.profiles.map((row) => [row.employee_id, row]));
  const netByMethod: DepositMethodTotals = {
    achCents: 0,
    checkCents: 0,
    cashCents: 0,
    unassignedCents: 0,
  };
  let employeeTaxesCents = 0;
  let employerTaxesCents = 0;

  for (const check of input.checks) {
    employeeTaxesCents += check.employeeDeductionCents;
    employerTaxesCents += check.employerTaxCents;
    const method = methodFor(check, profileById.get(check.employeeId));
    switch (method) {
      case "ach":
        netByMethod.achCents += check.netCents;
        break;
      case "check":
        netByMethod.checkCents += check.netCents;
        break;
      case "cash":
        netByMethod.cashCents += check.netCents;
        break;
      case "unassigned":
        netByMethod.unassignedCents += check.netCents;
        break;
      default: {
        const exhaustive: never = method;
        throw new Error(`Unhandled payment method: ${exhaustive}`);
      }
    }
  }

  const providerNet =
    netByMethod.achCents + netByMethod.checkCents + netByMethod.unassignedCents;
  return {
    netByMethod,
    employeeTaxesCents,
    employerTaxesCents,
    providerFundingCents: providerNet + (input.taxesViaProvider ? employeeTaxesCents + employerTaxesCents : 0),
  };
}
