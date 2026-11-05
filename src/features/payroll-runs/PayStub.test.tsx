import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PayrollCheck, TaxCode } from "../../lib/payroll-engine/types";
import { PayStub } from "./PayStub";

const codes = (values: Partial<Record<TaxCode, number>>): Record<TaxCode, number> => ({
  DIE: 0,
  "FED-ADD-MED": 0,
  "FED-FUT": 0,
  "FED-MED": 0,
  "FED-OASDI": 0,
  FSE: 0,
  SUT: 0,
  SWH: 0,
  ...values,
});

const line = (partial: Partial<PayrollCheck["earnings"][number]> & Pick<PayrollCheck["earnings"][number], "kind" | "amountCents">) => ({
  classId: null,
  positionId: null,
  hoursHundredths: 0,
  rateCents: null,
  workweekId: null,
  reason: null,
  ...partial,
});

const check: PayrollCheck = {
  employeeId: "e-ana",
  checkDate: "2026-11-06",
  taxYear: 2026,
  scheduleId: "biweekly",
  payType: "payroll",
  earnings: [
    line({ kind: "regular", hoursHundredths: 2000, rateCents: 300, amountCents: 6000, workweekId: "w1" }),
    line({ kind: "regular", hoursHundredths: 1000, rateCents: 300, amountCents: 3000, workweekId: "w2" }),
    line({ kind: "tips", amountCents: 50000 }),
    line({ kind: "adjustment", amountCents: 25000, reason: "Allowance bisemanal" }),
    line({ kind: "adjustment", amountCents: -1000, reason: "One-time adjustment" }),
  ],
  employeeWithholdings: [
    { code: "FED-OASDI", taxableCents: 83000, amountCents: 5146 },
    { code: "FED-MED", taxableCents: 83000, amountCents: 1204 },
    { code: "DIE", taxableCents: 83000, amountCents: 249 },
    { code: "SWH", taxableCents: 83000, amountCents: 3000 },
  ],
  employerTaxes: [],
  grossCents: 83000,
  employeeDeductionCents: 9599,
  netCents: 73401,
  employerTaxCents: 0,
  employerCostCents: 83000,
  closingYtd: {
    grossCents: 200000,
    taxableCents: codes({}),
    withheldCents: codes({ "FED-OASDI": 12400, "FED-MED": 2900, DIE: 600, SWH: 8000 }),
    employerWithheldCents: codes({}),
  },
  warnings: [],
  errors: [],
};

describe("PayStub", () => {
  it("shows a compact bilingual stub with merged earnings and year-to-date totals", () => {
    render(
      <PayStub
        check={check}
        employerName="Berrify LLC"
        employeeName="Ana Prueba"
        employeeNumber="0001"
        paymentMethod="Depósito directo"
        workplace="Harbor"
        periodStart="2026-10-19"
        periodEnd="2026-11-01"
      />,
    );

    expect(screen.getByRole("heading", { name: "Berrify LLC" })).toBeInTheDocument();
    expect(screen.getByText("Comprobante de pago / Pay stub")).toBeInTheDocument();
    expect(screen.getByText("Lugar de trabajo: Harbor")).toBeInTheDocument();
    expect(screen.getByText("Ana Prueba · #0001")).toBeInTheDocument();
    expect(screen.getByText("10/19/2026 - 11/01/2026")).toBeInTheDocument();
    expect(screen.getByText("11/06/2026")).toBeInTheDocument();
    expect(screen.getByText("Depósito directo")).toBeInTheDocument();

    // Two regular lines at the same rate become one row.
    const regular = screen.getByText("Regular").closest("tr")!;
    expect(within(regular).getByText("30.00")).toBeInTheDocument();
    expect(within(regular).getByText("$90.00")).toBeInTheDocument();
    expect(within(screen.getByText("Propinas").closest("tr")!).getByText("$500.00")).toBeInTheDocument();
    expect(within(screen.getByText("Allowance bisemanal").closest("tr")!).getByText("$250.00")).toBeInTheDocument();
    expect(within(screen.getByText("One-time adjustment").closest("tr")!).getByText("-$10.00")).toBeInTheDocument();

    const ss = screen.getByText("Seguro Social (6.2%)").closest("tr")!;
    expect(within(ss).getByText("$51.46")).toBeInTheDocument();
    expect(within(ss).getByText("$124.00")).toBeInTheDocument();
    expect(within(screen.getByText("Retención contributiva PR").closest("tr")!).getByText("$80.00")).toBeInTheDocument();

    expect(screen.getByText("$830.00")).toBeInTheDocument();
    expect(screen.getByText("$2,000.00")).toBeInTheDocument();
    expect(screen.getByText("$95.99")).toBeInTheDocument();
    expect(screen.getByText("$239.00")).toBeInTheDocument();
    expect(screen.getByText("$734.01")).toBeInTheDocument();
    expect(screen.getByText("Neto acumulado: $1,761.00")).toBeInTheDocument();
    expect(screen.getByText(/Seguro Social: 6\.2% de su gross \(\$830\.00 × 6\.2% = \$51\.46\)/)).toBeInTheDocument();
  });
});
