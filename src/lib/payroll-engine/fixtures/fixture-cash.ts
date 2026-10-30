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
      cashRateCents: 850,
      earnings: [
        { kind: "regular", hoursHundredths: 607, rateCents: 850, workweekId: "w1" },
        { kind: "tips", amountCents: 4146, workweekId: "w1" },
      ],
    },
    {
      employeeId: "C04",
      payType: "cash",
      isTipped: true,
      cashRateCents: 850,
      earnings: [
        { kind: "regular", hoursHundredths: 2939, rateCents: 850, workweekId: "w1" },
        { kind: "tips", amountCents: 16970, workweekId: "w1" },
      ],
    },
    {
      employeeId: "C05",
      payType: "cash",
      isTipped: true,
      cashRateCents: 500,
      earnings: [
        { kind: "regular", hoursHundredths: 408, rateCents: 500, workweekId: "w1" },
        { kind: "tips", amountCents: 2936, workweekId: "w1" },
      ],
    },
  ];
}
