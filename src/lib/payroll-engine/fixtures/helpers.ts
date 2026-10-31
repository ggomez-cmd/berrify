import type { EarningsLineInput, EmployeePayInput, ExemptionInput, OpeningYtd, TaxCode } from "../types";

export function overrideExemption(annualExemptionCents: number): ExemptionInput {
  return {
    personal: "none",
    annualExemptionOverrideCents: annualExemptionCents,
    biweeklyExemptionOverrideCents: 0,
  };
}

export function emptyYtd(overrides?: Partial<Record<TaxCode, number>>): OpeningYtd {
  return {
    grossCents: 0,
    taxableCents: { ...overrides },
    withheldCents: {},
  };
}

export function explicitEmployee(input: {
  employeeId: string;
  payType?: EmployeePayInput["payType"];
  kind: "hourly" | "salary";
  amountCents: number;
  hoursHundredths?: number;
  tipsCents?: number;
  extraAmountCents?: number;
  exemptionCents?: number;
  openingYtd?: OpeningYtd;
  isTipped?: boolean;
  classId?: string;
}): EmployeePayInput {
  const earnings: EarningsLineInput[] = [
    {
      kind: input.kind === "salary" ? ("salary" as const) : ("regular" as const),
      amountCents: input.amountCents,
      hoursHundredths: input.hoursHundredths ?? 0,
      classId: input.classId,
    },
  ];
  if (input.extraAmountCents) {
    earnings.push({
      kind: "regular",
      amountCents: input.extraAmountCents,
      hoursHundredths: 0,
      classId: input.classId,
    });
  }
  if (input.tipsCents) {
    earnings.push({
      kind: "tips",
      amountCents: input.tipsCents,
      hoursHundredths: 0,
      classId: input.classId,
    });
  }
  return {
    employeeId: input.employeeId,
    payType: input.payType ?? "payroll",
    isTipped: input.isTipped,
    exemption: overrideExemption(input.exemptionCents ?? 0),
    openingYtd: input.openingYtd ?? emptyYtd(),
    earnings,
  };
}

export function amountOn(check: { employeeWithholdings: Array<{ code: TaxCode; amountCents: number }>; employerTaxes: Array<{ code: TaxCode; amountCents: number }> }, code: TaxCode, side: "employee" | "employer" = "employee"): number {
  const lines = side === "employee" ? check.employeeWithholdings : check.employerTaxes;
  return lines.find((line) => line.code === code)?.amountCents ?? 0;
}
