import { describe, expect, it } from "vitest";
import { computeCheck, computePayrollRun } from "../payroll-engine";
import { amountOn, explicitEmployee } from "../payroll-engine/fixtures/helpers";
import {
  FIXTURE_A_CHECK_DATE,
  FIXTURE_A_ROWS,
  FIXTURE_A_SETTINGS,
  fixtureAEmployees,
} from "../payroll-engine/fixtures/fixture-a";
import { isoFromSeconds, utcSecondsFromZoned } from "../payroll-engine/hours/time";
import type { WorkedShift } from "../payroll-engine/hours/types";
import type {
  PayrollEmployeeProfileRow,
  PayrollEmployerSettingsRow,
  PayrollPayRateRow,
} from "../types";
import {
  buildRunInput,
  canApprove,
  toDraftPayload,
  ytdFromHistory,
  type PayrollRunSettingsSnapshot,
  type YtdOpeningBalance,
  type YtdPriorCheckTax,
} from "./runs";

const timestamps = {
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function localIso(ymd: string, time: string): string {
  const [hourText, minuteText, secondText] = time.split(":");
  return isoFromSeconds(
    utcSecondsFromZoned({
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: Number(hourText),
      minute: Number(minuteText),
      second: Number(secondText ?? "0"),
      timeZone: "America/Puerto_Rico",
    }),
  );
}

function employer(partial: Partial<PayrollEmployerSettingsRow> = {}): PayrollEmployerSettingsRow {
  return {
    id: "set-1",
    org_id: "org-1",
    effective_from: "2026-01-01",
    sut_rate_bp: 540,
    swh_method: "annualized",
    pay_frequency: "biweekly",
    daily_ot_mode: "rolling_24h",
    workweek_start_day: 0,
    time_zone: "America/Puerto_Rico",
    notes: null,
    ...timestamps,
    ...partial,
  };
}

function profile(
  partial: Partial<PayrollEmployeeProfileRow> & Pick<PayrollEmployeeProfileRow, "id" | "employee_id">,
): PayrollEmployeeProfileRow {
  return {
    org_id: "org-1",
    employee_number: "E-100",
    pay_type: "payroll",
    is_tipped: false,
    hire_date: "2024-03-01",
    daily_ot_multiplier_ppm: 1500000,
    weekly_ot_multiplier_ppm: 1500000,
    default_restaurant_id: "11111111-1111-4111-8111-111111111111",
    salary_cents: null,
    personal_exemption: "none",
    veteran: false,
    dependents: 0,
    reduced_dependents: 0,
    deduction_cents: 0,
    annual_exemption_override_cents: null,
    biweekly_exemption_override_cents: null,
    young_worker_exempt: false,
    additional_withholding_cents: 0,
    r41_effective_date: null,
    notes: null,
    ...timestamps,
    ...partial,
  };
}

function rate(
  partial: Partial<PayrollPayRateRow> & Pick<PayrollPayRateRow, "id" | "employee_id" | "rate_cents" | "effective_from">,
): PayrollPayRateRow {
  return {
    org_id: "org-1",
    restaurant_id: null,
    position: null,
    ...timestamps,
    ...partial,
  };
}

function shift(input: { id: string; employeeId: string; ymd: string; start: string; end: string }): WorkedShift {
  return {
    id: input.id,
    employeeId: input.employeeId,
    positionKey: "Cook",
    classId: "11111111-1111-4111-8111-111111111111",
    startedAt: localIso(input.ymd, input.start),
    endedAt: localIso(input.ymd, input.end),
    breaks: [],
    source: "time_clock",
  };
}

function wageBaseOpenings(employeeIds: readonly string[]): YtdOpeningBalance[] {
  return employeeIds.map((employeeId) => ({
    employeeId,
    taxYear: 2026,
    grossCents: 900_000,
    taxes: [
      { taxCode: "SUT" as const, taxableCents: 700_000, withheldCents: 0, employerCents: 37_800 },
      { taxCode: "FED-FUT" as const, taxableCents: 700_000, withheldCents: 0, employerCents: 4_200 },
      { taxCode: "DIE" as const, taxableCents: 900_000, withheldCents: 2_700, employerCents: 2_700 },
    ],
  }));
}

describe("ytdFromHistory", () => {
  it("adds opening balances in the tax year", () => {
    const ytd = ytdFromHistory(wageBaseOpenings(["A01"]), [], [], 2026).get("A01");
    expect(ytd?.taxableCents.SUT).toBe(700_000);
    expect(ytd?.taxableCents["FED-FUT"]).toBe(700_000);
    expect(ytd?.taxableCents.DIE).toBe(900_000);
  });

  it("counts a prior approved check toward wage bases and ignores a void one", () => {
    const taxes: YtdPriorCheckTax[] = [
      {
        employeeId: "A01",
        taxYear: 2026,
        checkDate: "2026-10-09",
        status: "approved",
        side: "employer",
        taxCode: "SUT",
        taxableCents: 700_000,
        amountCents: 37_800,
      },
      {
        employeeId: "A01",
        taxYear: 2026,
        checkDate: "2026-10-09",
        status: "approved",
        side: "employer",
        taxCode: "FED-FUT",
        taxableCents: 700_000,
        amountCents: 4_200,
      },
      {
        employeeId: "A01",
        taxYear: 2026,
        checkDate: "2026-10-09",
        status: "approved",
        side: "employee",
        taxCode: "DIE",
        taxableCents: 900_000,
        amountCents: 2_700,
      },
      {
        employeeId: "A01",
        taxYear: 2026,
        checkDate: "2026-09-25",
        status: "void",
        side: "employer",
        taxCode: "SUT",
        taxableCents: 50_000,
        amountCents: 2_700,
      },
    ];
    const ytd = ytdFromHistory([], taxes, [], 2026).get("A01");
    expect(ytd?.taxableCents.SUT).toBe(700_000);
    expect(ytd?.taxableCents["FED-FUT"]).toBe(700_000);
    expect(ytd?.taxableCents.DIE).toBe(900_000);

    const row = FIXTURE_A_ROWS[0];
    if (!row) throw new Error("missing A01");
    const check = computeCheck(
      explicitEmployee({
        employeeId: "A01",
        kind: "hourly",
        amountCents: row.regularOrSalaryCents,
        hoursHundredths: row.hoursHundredths,
        tipsCents: row.tipsCents,
        exemptionCents: 0,
        openingYtd: ytd,
      }),
      FIXTURE_A_SETTINGS,
      FIXTURE_A_CHECK_DATE,
    );
    expect(amountOn(check, "SUT", "employer")).toBe(0);
    expect(amountOn(check, "FED-FUT", "employer")).toBe(0);
    expect(amountOn(check, "DIE")).toBe(0);
  });
});

describe("buildRunInput", () => {
  it("reports missing settings, profile, and rate", () => {
    const built = buildRunInput({
      checkDate: FIXTURE_A_CHECK_DATE,
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      hoursSource: "time_clock",
      employerSettingsRows: [],
      profiles: [],
      payRates: [],
      shifts: [shift({ id: "s1", employeeId: "E1", ymd: "2026-10-13", start: "09:00:00", end: "17:00:00" })],
    });
    expect(built.errors.some((row) => row.includes("Missing employer settings"))).toBe(true);
    expect(built.errors.some((row) => row.includes("Missing payroll profile"))).toBe(true);
    expect(built.errors.some((row) => row.includes("Missing rate"))).toBe(true);
  });

  it("uses salary for salaried employees and warns on meal breaks and outside hours", () => {
    const built = buildRunInput({
      checkDate: FIXTURE_A_CHECK_DATE,
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      hoursSource: "time_clock",
      employerSettingsRows: [employer()],
      profiles: [profile({ id: "p1", employee_id: "E1", salary_cents: 190_000 })],
      payRates: [rate({ id: "r1", employee_id: "E1", rate_cents: 1500, effective_from: "2026-01-01" })],
      shifts: [
        shift({ id: "s-out", employeeId: "E1", ymd: "2026-01-02", start: "09:00:00", end: "17:00:00" }),
        {
          ...shift({ id: "s-meal", employeeId: "E1", ymd: "2026-10-13", start: "08:00:00", end: "16:00:00" }),
          breaks: [],
        },
      ],
    });
    const employee = built.input.employees[0];
    expect(employee?.salary?.amountCents).toBe(190_000);
    expect(employee?.hourlyWeeks).toBeUndefined();
    expect(built.warnings.some((row) => row.includes("outside the period"))).toBe(true);
    expect(built.warnings.some((row) => row.includes("meal break"))).toBe(true);
  });
});

describe("canApprove and toDraftPayload", () => {
  it("blocks approval when the engine reports errors or net is negative", () => {
    const ok = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees(),
    });
    expect(canApprove(ok)).toEqual({ ok: true });
    expect(canApprove({ ...ok, errors: ["A01: bad"] }).ok).toBe(false);
    expect(canApprove({ ...ok, checks: [] }).ok).toBe(false);
    const negative = { ...ok, checks: ok.checks.map((check, index) => (index === 0 ? { ...check, netCents: -1 } : check)) };
    expect(canApprove(negative).ok).toBe(false);
  });

  it("emits the jsonb keys the draft RPC reads", () => {
    const result = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees().slice(0, 1),
    });
    const settings: PayrollRunSettingsSnapshot = {
      ...FIXTURE_A_SETTINGS,
      dailyOtMode: "rolling_24h",
      workweekStartDow: 0,
      timeZone: "America/Puerto_Rico",
      workweekStartTime: "00:00",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
    };
    const payload = toDraftPayload(result, {
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      hoursSource: "time_clock",
      settings,
      inputs: {
        checkDate: result.checkDate,
        settings: FIXTURE_A_SETTINGS,
        employees: fixtureAEmployees().slice(0, 1),
        hoursSource: "time_clock",
        periodStart: "2026-10-12",
        periodEnd: "2026-10-25",
        shifts: [],
        tips: [],
        adjustments: [],
      },
    });
    expect(Object.keys(payload.run).sort()).toEqual(
      [
        "cash_gross_cents",
        "check_date",
        "employee_withholdings_cents",
        "employer_cost_cents",
        "employer_taxes_cents",
        "gross_cents",
        "hours_source",
        "inputs",
        "net_cents",
        "notes",
        "period_end",
        "period_start",
        "schedule_id",
        "settings",
      ].sort(),
    );
    expect(payload.checks[0]).toMatchObject({
      employee_id: "A01",
      pay_type: "payroll",
    });
    expect(payload.checks[0]?.earnings[0]).toHaveProperty("amount_cents");
    expect(payload.checks[0]?.taxes[0]).toMatchObject({
      side: expect.stringMatching(/employee|employer/),
      tax_code: expect.any(String),
    });
  });
});
