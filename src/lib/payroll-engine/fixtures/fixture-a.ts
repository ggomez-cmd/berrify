import type { EmployeePayInput, EmployerSettings } from "../types";
import { emptyYtd, explicitEmployee } from "./helpers";

export const FIXTURE_A_SETTINGS: EmployerSettings = {
  sutRateBp: 540,
  swhMethod: "annualized",
  payFrequency: "biweekly",
};

export const FIXTURE_A_CHECK_DATE = "2026-10-23";

export type FixtureARow = {
  employeeId: string;
  kind: "hourly" | "salary";
  hoursHundredths: number;
  regularOrSalaryCents: number;
  tipsCents: number;
  grossCents: number;
  dieCents: number;
  medCents: number;
  oasdiCents: number;
  swhCents: number;
  netCents: number;
  futCents: number;
  sutCents: number;
  exemptionCents: number;
};

export const FIXTURE_A_ROWS: FixtureARow[] = [
  { employeeId: "A01", kind: "hourly", hoursHundredths: 6816, regularOrSalaryCents: 71568, tipsCents: 61099, grossCents: 132667, dieCents: 398, medCents: 1924, oasdiCents: 8225, swhCents: 9420, netCents: 112700, futCents: 796, sutCents: 7164, exemptionCents: 0 },
  { employeeId: "A02", kind: "hourly", hoursHundredths: 5757, regularOrSalaryCents: 71962, tipsCents: 0, grossCents: 71962, dieCents: 216, medCents: 1043, oasdiCents: 4462, swhCents: 0, netCents: 66241, futCents: 432, sutCents: 3886, exemptionCents: 1_000_000 },
  { employeeId: "A03", kind: "hourly", hoursHundredths: 5615, regularOrSalaryCents: 28075, tipsCents: 72862, grossCents: 100937, dieCents: 303, medCents: 1464, oasdiCents: 6258, swhCents: 2758, netCents: 90154, futCents: 606, sutCents: 5451, exemptionCents: 700_000 },
  { employeeId: "A04", kind: "salary", hoursHundredths: 8000, regularOrSalaryCents: 190000, tipsCents: 0, grossCents: 190000, dieCents: 570, medCents: 2755, oasdiCents: 11780, swhCents: 20788, netCents: 154107, futCents: 1140, sutCents: 10260, exemptionCents: 0 },
  { employeeId: "A05", kind: "salary", hoursHundredths: 8000, regularOrSalaryCents: 369230, tipsCents: 0, grossCents: 369230, dieCents: 1108, medCents: 5354, oasdiCents: 22892, swhCents: 71769, netCents: 268107, futCents: 2215, sutCents: 19938, exemptionCents: 350_000 },
  { employeeId: "A06", kind: "salary", hoursHundredths: 8000, regularOrSalaryCents: 200000, tipsCents: 0, grossCents: 200000, dieCents: 600, medCents: 2900, oasdiCents: 12400, swhCents: 19923, netCents: 164177, futCents: 1200, sutCents: 10800, exemptionCents: 350_000 },
  { employeeId: "A07", kind: "hourly", hoursHundredths: 6650, regularOrSalaryCents: 63175, tipsCents: 66090, grossCents: 129265, dieCents: 388, medCents: 1874, oasdiCents: 8014, swhCents: 8943, netCents: 110046, futCents: 776, sutCents: 6980, exemptionCents: 0 },
  { employeeId: "A08", kind: "hourly", hoursHundredths: 4659, regularOrSalaryCents: 18636, tipsCents: 48411, grossCents: 67047, dieCents: 201, medCents: 972, oasdiCents: 4157, swhCents: 0, netCents: 61717, futCents: 402, sutCents: 3621, exemptionCents: 850_000 },
  { employeeId: "A09", kind: "hourly", hoursHundredths: 5621, regularOrSalaryCents: 61831, tipsCents: 0, grossCents: 61831, dieCents: 185, medCents: 897, oasdiCents: 3834, swhCents: 1905, netCents: 55010, futCents: 371, sutCents: 3339, exemptionCents: 0 },
  { employeeId: "A10", kind: "hourly", hoursHundredths: 5149, regularOrSalaryCents: 54064, tipsCents: 0, grossCents: 54064, dieCents: 162, medCents: 784, oasdiCents: 3352, swhCents: 688, netCents: 49078, futCents: 324, sutCents: 2919, exemptionCents: 250_000 },
  { employeeId: "A11", kind: "hourly", hoursHundredths: 7985, regularOrSalaryCents: 103805, tipsCents: 0, grossCents: 103805, dieCents: 311, medCents: 1505, oasdiCents: 6436, swhCents: 2824, netCents: 92729, futCents: 623, sutCents: 5605, exemptionCents: 750_000 },
  { employeeId: "A12", kind: "hourly", hoursHundredths: 7052, regularOrSalaryCents: 74046, tipsCents: 0, grossCents: 74046, dieCents: 222, medCents: 1074, oasdiCents: 4591, swhCents: 0, netCents: 68159, futCents: 444, sutCents: 3998, exemptionCents: 1_050_000 },
  { employeeId: "A13", kind: "hourly", hoursHundredths: 6994, regularOrSalaryCents: 104910, tipsCents: 71897, grossCents: 176807, dieCents: 530, medCents: 2564, oasdiCents: 10962, swhCents: 12368, netCents: 150383, futCents: 1061, sutCents: 9548, exemptionCents: 600_000 },
];

export const FIXTURE_A_TOTALS = {
  hoursHundredths: 86298,
  regularAndSalaryCents: 1_411_302,
  tipsCents: 320_359,
  grossCents: 1_731_661,
  employeeWithholdingsCents: 289_053,
  netCents: 1_442_608,
  employerTaxesCents: 241_566,
  liabilitiesCents: 530_619,
  employerCostCents: 1_973_227,
};

export function fixtureAEmployees(openingYtd = emptyYtd()): EmployeePayInput[] {
  return FIXTURE_A_ROWS.map((row) =>
    explicitEmployee({
      employeeId: row.employeeId,
      kind: row.kind,
      amountCents: row.regularOrSalaryCents,
      hoursHundredths: row.hoursHundredths,
      tipsCents: row.tipsCents,
      exemptionCents: row.exemptionCents,
      openingYtd,
    }),
  );
}

export const FIXTURE_A_YTD_REDUCTION = {
  sutCents: 93509,
  futCents: 10390,
  employerDieCents: 5194,
  employeeDieCents: 5194,
};
