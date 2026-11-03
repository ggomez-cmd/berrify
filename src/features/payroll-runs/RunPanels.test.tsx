import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PayrollCheck } from "../../lib/payroll-engine/types";
import { DepositSummaryPanel } from "./RunPanels";

const check = (partial: Partial<PayrollCheck> & Pick<PayrollCheck, "employeeId">): PayrollCheck => ({
  employeeId: partial.employeeId,
  checkDate: "2026-11-06",
  taxYear: 2026,
  scheduleId: "biweekly",
  payType: partial.payType ?? "payroll",
  earnings: [],
  employeeWithholdings: [],
  employerTaxes: [],
  grossCents: 10000,
  employeeDeductionCents: partial.employeeDeductionCents ?? 1000,
  netCents: partial.netCents ?? 8000,
  employerTaxCents: partial.employerTaxCents ?? 700,
  employerCostCents: 10700,
  closingYtd: {
    grossCents: 0,
    taxableCents: {
      DIE: 0,
      "FED-ADD-MED": 0,
      "FED-FUT": 0,
      "FED-MED": 0,
      "FED-OASDI": 0,
      FSE: 0,
      SUT: 0,
      SWH: 0,
    },
    withheldCents: {
      DIE: 0,
      "FED-ADD-MED": 0,
      "FED-FUT": 0,
      "FED-MED": 0,
      "FED-OASDI": 0,
      FSE: 0,
      SUT: 0,
      SWH: 0,
    },
    employerWithheldCents: {
      DIE: 0,
      "FED-ADD-MED": 0,
      "FED-FUT": 0,
      "FED-MED": 0,
      "FED-OASDI": 0,
      FSE: 0,
      SUT: 0,
      SWH: 0,
    },
  },
  warnings: [],
  errors: [],
});

describe("DepositSummaryPanel", () => {
  it("shows net by method, taxes, and provider funding with a taxes-not-via-provider note", () => {
    render(
      <DepositSummaryPanel
        checks={[
          check({ employeeId: "emp-1", netCents: 5000, employeeDeductionCents: 400, employerTaxCents: 200 }),
          check({ employeeId: "emp-2", payType: "cash", netCents: 3000, employeeDeductionCents: 0, employerTaxCents: 0 }),
        ]}
        profiles={[
          { employee_id: "emp-1", payment_method: "ach", pay_type: "payroll" },
          { employee_id: "emp-2", payment_method: "cash", pay_type: "cash" },
          { employee_id: "emp-3", payment_method: null, pay_type: "payroll" },
        ]}
        taxesViaProvider={false}
        names={{ "emp-1": "Pat Server", "emp-2": "Cash Cook", "emp-3": "Unassigned Host" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Deposit summary" })).toBeInTheDocument();
    expect(screen.getByText("Net by ACH")).toBeInTheDocument();
    expect(screen.getByText("Net by Check")).toBeInTheDocument();
    expect(screen.getByText("Net by Cash")).toBeInTheDocument();
    expect(screen.getByText("Net unassigned")).toBeInTheDocument();
    expect(screen.getByText("Employee taxes withheld")).toBeInTheDocument();
    expect(screen.getByText("Employer taxes")).toBeInTheDocument();
    expect(screen.getByText("Payroll provider funding")).toBeInTheDocument();
    expect(
      screen.getByText("Net pay only — taxes for this restaurant are not paid through the provider"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unassigned Host/)).toBeInTheDocument();
  });
});
