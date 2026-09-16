import { describe, expect, it } from "vitest";
import { toPayrollCsv, toPayrollTimeActivityIif, payrollFileStem } from "./payroll-export";
import type { PayrollLine } from "./payroll";

const meta = {
  restaurantName: "Semilla",
  restaurantSlug: "semilla",
  periodStart: new Date("2026-09-06T04:00:00.000Z"),
  periodEnd: new Date("2026-09-13T04:00:00.000Z"),
  timeZone: "America/Puerto_Rico",
};

const lines: PayrollLine[] = [
  {
    employee_id: "emp-1",
    full_name: "Sofia\tReyes",
    regular_seconds: 40 * 3600,
    ot_seconds: 5 * 3600,
    hourly_rate: 12,
    gross: 570,
  },
];

describe("payroll CSV", () => {
  it("names the file from restaurant slug and period start", () => {
    expect(payrollFileStem(meta)).toBe("semilla-payroll-2026-09-06");
  });

  it("includes employee hours, rate, and gross for the workweek", () => {
    const csv = toPayrollCsv(lines, meta);
    expect(csv).toContain("Employee,Restaurant,Period start,Period end,Regular hours,OT hours,Rate,Gross");
    expect(csv).toContain("Sofia Reyes");
    expect(csv).toContain("Semilla");
    expect(csv).toContain("2026-09-06");
    expect(csv).toContain("2026-09-12");
    expect(csv).toContain("40");
    expect(csv).toContain("5");
    expect(csv).toContain("12");
    expect(csv).toContain("570");
  });
});

describe("payroll TIMEACTIVITY IIF", () => {
  it("emits Hourly and Overtime TIMEACT rows, not BILL or paycheck", () => {
    const iif = toPayrollTimeActivityIif(lines, meta);
    expect(iif).toContain("!TIMEACT");
    expect(iif).toContain("TIMEACT");
    expect(iif).toContain("Hourly");
    expect(iif).toContain("Overtime");
    expect(iif).toContain("Sofia Reyes");
    expect(iif).toContain("40:00");
    expect(iif).toContain("5:00");
    expect(iif).not.toMatch(/(^|\t)BILL(\t|$)/m);
    expect(iif).not.toContain("PAYCHECK");
    expect(iif).not.toContain("TRNS");
    expect(iif.split("\n").some((row) => row.includes("Sofia\tReyes"))).toBe(false);
  });
});
