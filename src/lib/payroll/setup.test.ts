import { describe, expect, it } from "vitest";
import {
  basisPointsToPercentInput,
  buildPayrollEmployeeSetupProfile,
  buildPayrollPayRateSetupPayloads,
  centsToDollarInput,
  cloverMappingFrom,
  dollarsToCents,
  DUPLICATE_PAY_RATE_ERROR,
  employeePayBase,
  employerSettingsFor,
  findDuplicatePayRateError,
  OPENING_BALANCES_CSV_HEADER,
  parseOpeningBalancesCsv,
  percentToBasisPoints,
  rateFor,
  toOpeningBalanceImportPayloads,
  type PayrollCloverNameRow,
  type PayrollEmployeeProfileRow,
  type PayrollEmployeeSetupDraft,
  type PayrollEmployerSettingsRow,
  type PayrollOpeningBalanceRow,
  type PayrollOpeningBalanceTaxRow,
  type PayrollPayRateRow,
} from "./setup";

const timestamps = {
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function employer(
  partial: Partial<PayrollEmployerSettingsRow> & Pick<PayrollEmployerSettingsRow, "id" | "effective_from">,
): PayrollEmployerSettingsRow {
  return {
    org_id: "org-1",
    sut_rate_bp: 270,
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
    default_restaurant_id: "rest-harbor",
    salary_cents: null,
    personal_exemption: "single",
    veteran: false,
    dependents: 1,
    reduced_dependents: 0,
    deduction_cents: 50000,
    annual_exemption_override_cents: null,
    biweekly_exemption_override_cents: null,
    young_worker_exempt: false,
    additional_withholding_cents: 2500,
    r41_effective_date: "2026-01-15",
    notes: null,
    ...timestamps,
    ...partial,
  };
}

function rate(
  partial: Partial<PayrollPayRateRow> &
    Pick<PayrollPayRateRow, "id" | "employee_id" | "rate_cents" | "effective_from">,
): PayrollPayRateRow {
  return {
    org_id: "org-1",
    restaurant_id: null,
    position: null,
    ...timestamps,
    ...partial,
  };
}

function clover(
  partial: Partial<PayrollCloverNameRow> & Pick<PayrollCloverNameRow, "id" | "clover_name">,
): PayrollCloverNameRow {
  return {
    org_id: "org-1",
    employee_id: null,
    ignored: false,
    ...timestamps,
    ...partial,
  };
}

describe("money helpers", () => {
  it("converts dollar strings to cents without float math", () => {
    expect(dollarsToCents("1,234.56")).toBe(123456);
    expect(dollarsToCents("$10")).toBe(1000);
    expect(dollarsToCents("10.5")).toBe(1050);
    expect(dollarsToCents("-1.00")).toBeNull();
    expect(dollarsToCents("1.234")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(centsToDollarInput(123456)).toBe("1234.56");
  });

  it("converts percents to basis points", () => {
    expect(percentToBasisPoints("2.70")).toBe(270);
    expect(percentToBasisPoints("5")).toBe(500);
    expect(percentToBasisPoints("-1")).toBeNull();
    expect(percentToBasisPoints("100.01")).toBeNull();
    expect(basisPointsToPercentInput(270)).toBe("2.70");
  });
});

describe("employerSettingsFor", () => {
  const rows = [
    employer({ id: "set-2025", effective_from: "2025-01-01", sut_rate_bp: 240, daily_ot_mode: "calendar_day" }),
    employer({ id: "set-2026", effective_from: "2026-01-01", sut_rate_bp: 270, swh_method: "biweekly_table" }),
    employer({ id: "set-future", effective_from: "2027-01-01", sut_rate_bp: 300 }),
  ];

  it("returns the latest row on or before the check date", () => {
    expect(employerSettingsFor(rows, "2026-06-15")).toEqual({
      sutRateBp: 270,
      swhMethod: "biweekly_table",
      payFrequency: "biweekly",
      dailyOtMode: "rolling_24h",
      workweekStartDow: 0,
      timeZone: "America/Puerto_Rico",
    });
    expect(employerSettingsFor(rows, "2025-12-31").sutRateBp).toBe(240);
    expect(employerSettingsFor(rows, "2025-12-31").dailyOtMode).toBe("calendar_day");
  });

  it("throws when nothing is effective yet", () => {
    expect(() => employerSettingsFor(rows, "2024-12-31")).toThrow("No employer settings are effective on 2024-12-31");
  });
});

describe("rateFor", () => {
  const employeeId = "emp-jordan";
  const rates = [
    rate({ id: "base-old", employee_id: employeeId, rate_cents: 1100, effective_from: "2025-01-01" }),
    rate({ id: "base", employee_id: employeeId, rate_cents: 1200, effective_from: "2026-01-01" }),
    rate({
      id: "pos",
      employee_id: employeeId,
      position: "Cook",
      rate_cents: 1400,
      effective_from: "2026-01-01",
    }),
    rate({
      id: "rest",
      employee_id: employeeId,
      restaurant_id: "rest-harbor",
      rate_cents: 1500,
      effective_from: "2026-01-01",
    }),
    rate({
      id: "both",
      employee_id: employeeId,
      restaurant_id: "rest-harbor",
      position: "Cook",
      rate_cents: 1800,
      effective_from: "2026-03-01",
    }),
    rate({
      id: "other-emp",
      employee_id: "emp-casey",
      restaurant_id: "rest-harbor",
      position: "Cook",
      rate_cents: 9999,
      effective_from: "2026-01-01",
    }),
  ];

  it("prefers restaurant+position over restaurant over position over neither", () => {
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-harbor",
        position: "Cook",
        onDate: "2026-06-01",
      })?.id,
    ).toBe("both");
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-harbor",
        position: "Server",
        onDate: "2026-06-01",
      })?.id,
    ).toBe("rest");
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-inlet",
        position: "Cook",
        onDate: "2026-06-01",
      })?.id,
    ).toBe("pos");
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-inlet",
        position: "Host",
        onDate: "2026-06-01",
      })?.id,
    ).toBe("base");
  });

  it("uses the latest effective date that is not after the lookup date", () => {
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-inlet",
        position: "Host",
        onDate: "2025-06-01",
      })?.rate_cents,
    ).toBe(1100);
    expect(
      rateFor(rates, {
        employeeId,
        restaurantId: "rest-harbor",
        position: "Cook",
        onDate: "2026-02-01",
      })?.id,
    ).toBe("rest");
  });

  it("returns null when no rate matches", () => {
    expect(
      rateFor(rates, {
        employeeId: "emp-nobody",
        restaurantId: "rest-harbor",
        position: "Cook",
        onDate: "2026-06-01",
      }),
    ).toBeNull();
  });
});

describe("employeePayBase", () => {
  const jordan = profile({ id: "prof-1", employee_id: "emp-jordan", salary_cents: 250000 });

  function opening(
    partial: Partial<PayrollOpeningBalanceRow> &
      Pick<PayrollOpeningBalanceRow, "id" | "source" | "gross_cents"> & {
        taxes: PayrollOpeningBalanceTaxRow[];
      },
  ): PayrollOpeningBalanceRow & { taxes: PayrollOpeningBalanceTaxRow[] } {
    return {
      org_id: "org-1",
      employee_id: "emp-jordan",
      tax_year: 2026,
      notes: null,
      ...timestamps,
      ...partial,
    };
  }

  it("maps profile fields and sums opening YTD from every source in the tax year", () => {
    const balances = [
      opening({
        id: "ob-a",
        source: "Predecessor LLC",
        gross_cents: 100000,
        taxes: [
          {
            id: "t-a-swh",
            org_id: "org-1",
            opening_balance_id: "ob-a",
            tax_code: "SWH",
            taxable_cents: 90000,
            withheld_cents: 4000,
            employer_cents: 0,
            ...timestamps,
          },
          {
            id: "t-a-oasdi",
            org_id: "org-1",
            opening_balance_id: "ob-a",
            tax_code: "FED-OASDI",
            taxable_cents: 100000,
            withheld_cents: 6200,
            employer_cents: 6200,
            ...timestamps,
          },
        ],
      }),
      opening({
        id: "ob-b",
        source: "Temp Agency",
        gross_cents: 50000,
        taxes: [
          {
            id: "t-b-swh",
            org_id: "org-1",
            opening_balance_id: "ob-b",
            tax_code: "SWH",
            taxable_cents: 45000,
            withheld_cents: 1500,
            employer_cents: 0,
            ...timestamps,
          },
        ],
      }),
      opening({
        id: "ob-old",
        source: "Predecessor LLC",
        tax_year: 2025,
        gross_cents: 999999,
        taxes: [],
      }),
    ];

    const input = employeePayBase(jordan, balances, 2026);
    expect(input.employeeId).toBe("emp-jordan");
    expect(input.payType).toBe("payroll");
    expect(input.additionalWithholdingCents).toBe(2500);
    expect(input.exemption?.personal).toBe("single");
    expect(input.exemption?.dependents).toBe(1);
    expect(input.exemption?.deductionCents).toBe(50000);
    expect(input.salary).toEqual({ amountCents: 250000, classId: "rest-harbor" });
    expect(input.openingYtd?.grossCents).toBe(150000);
    expect(input.openingYtd?.taxableCents.SWH).toBe(135000);
    expect(input.openingYtd?.withheldCents.SWH).toBe(5500);
    expect(input.openingYtd?.withheldCents["FED-OASDI"]).toBe(6200);
    expect(input.openingYtd?.employerWithheldCents?.["FED-OASDI"]).toBe(6200);
  });

  it("omits opening YTD and salary when they are not present", () => {
    const hourly = profile({ id: "prof-2", employee_id: "emp-casey", salary_cents: null });
    const input = employeePayBase(hourly, [], 2026);
    expect(input.openingYtd).toBeUndefined();
    expect(input.salary).toBeUndefined();
  });
});

describe("cloverMappingFrom", () => {
  it("builds mapping and ignore lists for parseCloverShifts", () => {
    const result = cloverMappingFrom([
      clover({ id: "c-1", clover_name: "Jordan H", employee_id: "emp-jordan" }),
      clover({ id: "c-2", clover_name: "Training Till", ignored: true }),
    ]);
    expect(result.mapping).toEqual({
      "Jordan H": { employeeId: "emp-jordan", positionKey: "unmapped", classId: "unmapped" },
    });
    expect(result.ignore).toEqual(["Training Till"]);
  });
});

describe("parseOpeningBalancesCsv", () => {
  const header = OPENING_BALANCES_CSV_HEADER;

  it("parses dollar columns into cents and optional tax columns", () => {
    const csv = [
      header,
      "E-100,2026,Predecessor LLC,\"1,234.56\",,,,12.00,0.74,0.74",
    ].join("\n");
    const parsed = parseOpeningBalancesCsv(csv, { "E-100": "emp-jordan" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      employeeNumber: "E-100",
      employeeId: "emp-jordan",
      taxYear: 2026,
      source: "Predecessor LLC",
      grossCents: 123456,
    });
    expect(parsed.rows[0]?.taxes).toEqual([
      { taxCode: "FED-ADD-MED", taxableCents: 1200, withheldCents: 74, employerCents: 74 },
    ]);
  });

  it("collects per-line errors for bad numbers, unknown people, and duplicates", () => {
    const csv = [
      "employee_number,tax_year,source,gross,SWH_taxable,mystery",
      "E-100,2026,Predecessor LLC,-10.00,1.00,",
      "E-404,2026,Predecessor LLC,10.00,1.00,",
      "E-100,2026,Predecessor LLC,10.00,1.00,",
      "E-100,2026,Predecessor LLC,20.00,2.00,",
    ].join("\n");
    const parsed = parseOpeningBalancesCsv(csv, { "E-100": "emp-jordan" });
    expect(parsed.errors.map((error) => error.message)).toEqual([
      "Unknown column mystery",
    ]);

    const dataCsv = [
      "employee_number,tax_year,source,gross,SWH_taxable",
      "E-100,2026,Predecessor LLC,-10.00,1.00",
      "E-404,2026,Predecessor LLC,10.00,1.00",
      "E-100,2026,Predecessor LLC,10.00,1.00",
      "E-100,2026,Predecessor LLC,20.00,2.00",
      "E-100,not-a-year,Predecessor LLC,10.00,1.00",
    ].join("\n");
    const data = parseOpeningBalancesCsv(dataCsv, { "E-100": "emp-jordan" });
    expect(data.errors).toEqual(
      expect.arrayContaining([
        { line: 2, message: "gross must be a non-negative dollar amount" },
        { line: 3, message: "Unknown employee number E-404" },
        { line: 5, message: "Duplicate employee E-100 / 2026 / Predecessor LLC" },
        { line: 6, message: "tax_year must be a 4-digit year" },
      ]),
    );
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.grossCents).toBe(1000);
  });
});

describe("findDuplicatePayRateError", () => {
  it("treats null restaurant and position as the same match key as empty", () => {
    expect(
      findDuplicatePayRateError([
        { restaurant_id: null, position: null, effective_from: "2026-01-01" },
        { restaurant_id: null, position: null, effective_from: "2026-01-01" },
      ]),
    ).toBe(DUPLICATE_PAY_RATE_ERROR);
    expect(
      findDuplicatePayRateError([
        { restaurant_id: "rest-harbor", position: "Cook", effective_from: "2026-01-01" },
        { restaurant_id: "rest-harbor", position: "Cook", effective_from: "2026-06-01" },
      ]),
    ).toBeNull();
  });
});

describe("setup RPC payload builders", () => {
  const draft: PayrollEmployeeSetupDraft = {
    employee_number: " E-100 ",
    pay_type: "payroll",
    is_tipped: true,
    hire_date: "2024-03-01",
    daily_ot_multiplier_ppm: "1500000",
    weekly_ot_multiplier_ppm: "1500000",
    default_restaurant_id: "rest-harbor",
    salary_dollars: "",
    personal_exemption: "single",
    veteran: false,
    dependents: "1",
    reduced_dependents: "0",
    deduction_dollars: "500.00",
    annual_exemption_override_dollars: "",
    biweekly_exemption_override_dollars: "",
    young_worker_exempt: false,
    additional_withholding_dollars: "25.00",
    r41_effective_date: "2026-01-15",
    notes: "  night  ",
  };

  it("builds the employee setup jsonb with the SQL keys", () => {
    const result = buildPayrollEmployeeSetupProfile(draft);
    expect(result).toEqual({
      ok: true,
      value: {
        employee_number: "E-100",
        pay_type: "payroll",
        is_tipped: true,
        hire_date: "2024-03-01",
        daily_ot_multiplier_ppm: 1500000,
        weekly_ot_multiplier_ppm: 1500000,
        default_restaurant_id: "rest-harbor",
        salary_cents: null,
        personal_exemption: "single",
        veteran: false,
        dependents: 1,
        reduced_dependents: 0,
        deduction_cents: 50000,
        annual_exemption_override_cents: null,
        biweekly_exemption_override_cents: null,
        young_worker_exempt: false,
        additional_withholding_cents: 2500,
        r41_effective_date: "2026-01-15",
        notes: "night",
      },
    });
  });

  it("rejects invalid dollars and duplicate restaurant/position/effective_from rates", () => {
    expect(buildPayrollEmployeeSetupProfile({ ...draft, salary_dollars: "-10.00" })).toEqual({
      ok: false,
      error: "Dollar amounts must look like 1,234.56 with no negatives",
    });
    expect(
      buildPayrollPayRateSetupPayloads([
        { restaurant_id: "rest-harbor", position: "Cook", rate_dollars: "12.00", effective_from: "2026-01-01" },
        { restaurant_id: "rest-harbor", position: "Cook", rate_dollars: "13.00", effective_from: "2026-01-01" },
      ]),
    ).toEqual({ ok: false, error: DUPLICATE_PAY_RATE_ERROR });
    expect(
      buildPayrollPayRateSetupPayloads([
        { restaurant_id: "", position: "", rate_dollars: "12.00", effective_from: "2026-01-01" },
      ]),
    ).toEqual({
      ok: true,
      value: [{ restaurant_id: null, position: null, rate_cents: 1200, effective_from: "2026-01-01" }],
    });
  });

  it("maps opening-balance import rows onto the SQL jsonb keys", () => {
    expect(
      toOpeningBalanceImportPayloads([
        {
          employeeNumber: "E-100",
          employeeId: "emp-jordan",
          taxYear: 2026,
          source: "Predecessor LLC",
          grossCents: 123456,
          taxes: [{ taxCode: "SWH", taxableCents: 1000, withheldCents: 40, employerCents: 0 }],
        },
      ]),
    ).toEqual([
      {
        employee_id: "emp-jordan",
        tax_year: 2026,
        source: "Predecessor LLC",
        gross_cents: 123456,
        taxes: [{ tax_code: "SWH", taxable_cents: 1000, withheld_cents: 40, employer_cents: 0 }],
      },
    ]);
    expect(() =>
      toOpeningBalanceImportPayloads([
        {
          employeeNumber: "E-404",
          employeeId: null,
          taxYear: 2026,
          source: "Predecessor LLC",
          grossCents: 100,
          taxes: [],
        },
      ]),
    ).toThrow("Missing employee for E-404");
  });
});
