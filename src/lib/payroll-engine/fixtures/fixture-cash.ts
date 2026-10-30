import type { EmployeePayInput, EmployerSettings } from "../types";

export const FIXTURE_CASH_SETTINGS: EmployerSettings = {
  sutRateBp: 540,
  swhMethod: "annualized",
  payFrequency: "biweekly",
};

export const FIXTURE_CASH_CHECK_DATE = "2026-10-23";

export const FIXTURE_CASH_TOTAL_CENTS = 135295;

export function fixtureCashEmployees(): EmployeePayInput[] {
  return [
    {
      employeeId: "C01",
      payType: "cash",
      earnings: [{ kind: "regular", hoursHundredths: 2186, rateCents: 1700 }],
    },
    {
      employeeId: "C02",
      payType: "cash",
      earnings: [{ kind: "regular", hoursHundredths: 3223, rateCents: 1300 }],
    },
    {
      employeeId: "C03",
      payType: "cash",
      isTipped: true,
      hourlyWeeks: [{ workweekId: "w1", rateCents: 850, regularHoursHundredths: 607, tipsCents: 4146 }],
    },
    {
      employeeId: "C04",
      payType: "cash",
      isTipped: true,
      hourlyWeeks: [{ workweekId: "w1", rateCents: 850, regularHoursHundredths: 2939, tipsCents: 16970 }],
    },
    {
      employeeId: "C05",
      payType: "cash",
      isTipped: true,
      hourlyWeeks: [{ workweekId: "w1", rateCents: 500, regularHoursHundredths: 408, tipsCents: 2936 }],
    },
  ];
}
