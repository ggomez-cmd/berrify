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
import type { PayrollRunWithChecks } from "../types";
import { summarizeRun } from "./reports";
import {
  buildRunInput,
  canApprove,
  payrollCalculationIsStale,
  previewPayrollRun,
  resultFromStoredRun,
  toDraftPayload,
  ytdFromHistory,
  type PayrollCalculationSource,
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

  it("keeps restaurant-specific rates for the same position ($140.00)", () => {
    const restaurantA = "11111111-1111-4111-8111-111111111111";
    const restaurantB = "22222222-2222-4222-8222-222222222222";
    const built = buildRunInput({
      checkDate: FIXTURE_A_CHECK_DATE,
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      hoursSource: "time_clock",
      employerSettingsRows: [employer()],
      profiles: [profile({ id: "p1", employee_id: "E1" })],
      payRates: [
        rate({
          id: "r-a",
          employee_id: "E1",
          restaurant_id: restaurantA,
          position: "Cook",
          rate_cents: 1500,
          effective_from: "2026-01-01",
        }),
        rate({
          id: "r-b",
          employee_id: "E1",
          restaurant_id: restaurantB,
          position: "Cook",
          rate_cents: 2000,
          effective_from: "2026-01-01",
        }),
      ],
      shifts: [
        {
          ...shift({ id: "s-a", employeeId: "E1", ymd: "2026-10-13", start: "09:00:00", end: "13:00:00" }),
          classId: restaurantA,
        },
        {
          ...shift({ id: "s-b", employeeId: "E1", ymd: "2026-10-14", start: "09:00:00", end: "13:00:00" }),
          classId: restaurantB,
        },
      ],
    });
    expect(built.errors).toEqual([]);
    const preview = previewPayrollRun(built);
    expect(preview.checks[0]?.grossCents).toBe(14_000);
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
    expect(payload.run.errors).toEqual(result.errors);
    expect(payload.run.warnings).toEqual(result.warnings);
    expect(Object.keys(payload.run).sort()).toEqual(
      [
        "cash_gross_cents",
        "check_date",
        "employee_withholdings_cents",
        "employer_cost_cents",
        "employer_taxes_cents",
        "errors",
        "gross_cents",
        "hours_source",
        "inputs",
        "net_cents",
        "notes",
        "period_end",
        "period_start",
        "schedule_id",
        "settings",
        "warnings",
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

  it("carries combined build and engine errors so a draft stays unapprovable", () => {
    const result = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees().slice(0, 1),
    });
    const withErrors = { ...result, errors: [...result.errors, "Missing rate for employee E1 (Cook) on 2026-10-13"] };
    expect(canApprove(withErrors).ok).toBe(false);
    const payload = toDraftPayload(withErrors, {
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      hoursSource: "time_clock",
      settings: {
        ...FIXTURE_A_SETTINGS,
        dailyOtMode: "rolling_24h",
        workweekStartDow: 0,
        timeZone: "America/Puerto_Rico",
        workweekStartTime: "00:00",
        periodStart: "2026-10-12",
        periodEnd: "2026-10-25",
      },
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
    expect(payload.run.errors).toContain("Missing rate for employee E1 (Cook) on 2026-10-13");
  });
});

const source = (partial: Partial<PayrollCalculationSource> = {}): PayrollCalculationSource => ({
  periodStart: "2026-10-12",
  periodEnd: "2026-10-25",
  checkDate: "2026-10-23",
  hoursSource: "time_clock",
  cloverCsv: "",
  tips: {},
  adjustments: [],
  ...partial,
});

describe("payrollCalculationIsStale", () => {
  it("invalidates a calculated result after period, date, source, Clover, tips, or adjustments change", () => {
    const original = source({
      cloverCsv: "name,in,out",
      tips: { "E1\t2026-10-12": "10.00" },
      adjustments: [{ employeeId: "E1", dollars: "5.00", reason: "bonus", restaurantId: "r1" }],
    });
    expect(payrollCalculationIsStale(null, original)).toBe(true);
    expect(payrollCalculationIsStale(original, original)).toBe(false);
    expect(payrollCalculationIsStale(original, source({ ...original, periodStart: "2026-10-13" }))).toBe(true);
    expect(payrollCalculationIsStale(original, source({ ...original, periodEnd: "2026-10-24" }))).toBe(true);
    expect(payrollCalculationIsStale(original, source({ ...original, checkDate: "2026-10-24" }))).toBe(true);
    expect(payrollCalculationIsStale(original, source({ ...original, hoursSource: "clover" }))).toBe(true);
    expect(payrollCalculationIsStale(original, source({ ...original, cloverCsv: "changed" }))).toBe(true);
    expect(payrollCalculationIsStale(original, source({ ...original, tips: { "E1\t2026-10-12": "12.00" } }))).toBe(true);
    expect(
      payrollCalculationIsStale(
        original,
        source({
          ...original,
          adjustments: [{ employeeId: "E1", dollars: "6.00", reason: "bonus", restaurantId: "r1" }],
        }),
      ),
    ).toBe(true);
  });
});

function storedRun(partial: Partial<PayrollRunWithChecks> = {}): PayrollRunWithChecks {
  const fixture = computePayrollRun({
    checkDate: FIXTURE_A_CHECK_DATE,
    settings: FIXTURE_A_SETTINGS,
    employees: fixtureAEmployees().slice(0, 1),
  });
  const check = fixture.checks[0];
  if (!check) throw new Error("missing fixture check");
  return {
    id: "run-1",
    org_id: "org-1",
    period_start: "2026-10-12",
    period_end: "2026-10-25",
    check_date: FIXTURE_A_CHECK_DATE,
    status: "approved",
    hours_source: "time_clock",
    schedule_id: fixture.scheduleId,
    settings: FIXTURE_A_SETTINGS,
    inputs: {
      checkDate: fixture.checkDate,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees().slice(0, 1),
      hoursSource: "time_clock",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-25",
      shifts: [],
      tips: [],
      adjustments: [],
    },
    gross_cents: 99_999,
    employee_withholdings_cents: 1_111,
    net_cents: 88_888,
    employer_taxes_cents: 2_222,
    employer_cost_cents: 102_221,
    cash_gross_cents: 0,
    errors: [],
    warnings: [],
    approved_by: "user-1",
    approved_at: "2026-10-23T12:00:00.000Z",
    voided_at: null,
    void_reason: null,
    notes: null,
    created_at: timestamps.created_at,
    updated_at: timestamps.updated_at,
    payroll_checks: [
      {
        id: "check-1",
        org_id: "org-1",
        run_id: "run-1",
        employee_id: check.employeeId,
        pay_type: check.payType,
        gross_cents: 99_999,
        deductions_cents: 1_111,
        net_cents: 88_888,
        employer_tax_cents: 2_222,
        closing_ytd: check.closingYtd,
        created_at: timestamps.created_at,
        updated_at: timestamps.updated_at,
        payroll_check_earnings: check.earnings.map((line, index) => ({
          id: `earn-${index}`,
          org_id: "org-1",
          check_id: "check-1",
          kind: line.kind,
          restaurant_id: line.classId,
          position: line.positionId,
          workweek_id: line.workweekId,
          hours_hundredths: line.hoursHundredths,
          rate_cents: line.rateCents,
          amount_cents: index === 0 ? 99_999 : 0,
          reason: line.reason,
          created_at: timestamps.created_at,
        })),
        payroll_check_taxes: [
          ...check.employeeWithholdings.map((line, index) => ({
            id: `tax-ee-${index}`,
            org_id: "org-1",
            check_id: "check-1",
            side: "employee" as const,
            tax_code: line.code,
            taxable_cents: line.taxableCents,
            amount_cents: index === 0 ? 1_111 : 0,
            created_at: timestamps.created_at,
          })),
          ...check.employerTaxes.map((line, index) => ({
            id: `tax-er-${index}`,
            org_id: "org-1",
            check_id: "check-1",
            side: "employer" as const,
            tax_code: line.code,
            taxable_cents: line.taxableCents,
            amount_cents: index === 0 ? 2_222 : 0,
            created_at: timestamps.created_at,
          })),
        ],
      },
    ],
    ...partial,
  };
}

describe("resultFromStoredRun", () => {
  it("reads approved reports from the stored ledger even when a recompute would differ", () => {
    const run = storedRun();
    const recomputed = computePayrollRun({
      checkDate: FIXTURE_A_CHECK_DATE,
      settings: FIXTURE_A_SETTINGS,
      employees: fixtureAEmployees().slice(0, 1),
    });
    expect(recomputed.payrollGrossCents).not.toBe(99_999);
    const result = resultFromStoredRun(run);
    expect(result.payrollGrossCents).toBe(99_999);
    expect(result.employeeDeductionCents).toBe(1_111);
    expect(result.netPayCents).toBe(88_888);
    expect(result.employerTaxCents).toBe(2_222);
    expect(summarizeRun(result).payrollGrossCents).toBe(99_999);
    expect(summarizeRun(result).netPayCents).toBe(88_888);
  });

  it("surfaces stored draft errors so a reopened run stays unapprovable", () => {
    const run = storedRun({
      status: "draft",
      errors: ["Missing rate for employee E1 (Cook) on 2026-10-13"],
      warnings: ["Hours outside the period"],
      gross_cents: 0,
    });
    const result = resultFromStoredRun(run);
    expect(result.errors).toContain("Missing rate for employee E1 (Cook) on 2026-10-13");
    expect(result.warnings).toContain("Hours outside the period");
    expect(canApprove(result).ok).toBe(false);
  });
});
