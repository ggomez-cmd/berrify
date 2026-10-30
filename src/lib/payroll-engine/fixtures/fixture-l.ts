import type { EmployeePayInput, EmployerSettings } from "../types";
import { explicitEmployee } from "./helpers";

export const FIXTURE_L_SETTINGS: EmployerSettings = {
  sutRateBp: 540,
  swhMethod: "biweekly_table",
  payFrequency: "biweekly",
};

export const FIXTURE_L_CHECK_DATE = "2026-10-23";

export type FixtureLRow = {
  employeeId: string;
  kind: "hourly" | "salary";
  amountsCents: number[];
  tipsCents: number;
  grossCents: number;
  oasdiCents: number;
  medCents: number;
  dieCents: number;
  swhCents: number;
  netCents: number;
};

export const FIXTURE_L_ROWS: FixtureLRow[] = [
  { employeeId: "L01", kind: "hourly", amountsCents: [82726], tipsCents: 0, grossCents: 82726, oasdiCents: 5129, medCents: 1200, dieCents: 248, swhCents: 3371, netCents: 72778 },
  { employeeId: "L02", kind: "hourly", amountsCents: [46997], tipsCents: 97320, grossCents: 144317, oasdiCents: 8948, medCents: 2093, dieCents: 433, swhCents: 11054, netCents: 121789 },
  { employeeId: "L03", kind: "hourly", amountsCents: [48581], tipsCents: 0, grossCents: 48581, oasdiCents: 3012, medCents: 704, dieCents: 146, swhCents: 981, netCents: 43738 },
  { employeeId: "L04", kind: "hourly", amountsCents: [10296, 4701], tipsCents: 62836, grossCents: 77833, oasdiCents: 4826, medCents: 1129, dieCents: 233, swhCents: 3028, netCents: 68617 },
  { employeeId: "L05", kind: "hourly", amountsCents: [21447], tipsCents: 50870, grossCents: 72317, oasdiCents: 4484, medCents: 1049, dieCents: 217, swhCents: 2642, netCents: 63925 },
  { employeeId: "L06", kind: "hourly", amountsCents: [8358, 4735], tipsCents: 46473, grossCents: 59566, oasdiCents: 3693, medCents: 864, dieCents: 179, swhCents: 1750, netCents: 53080 },
  { employeeId: "L07", kind: "hourly", amountsCents: [10248], tipsCents: 0, grossCents: 10248, oasdiCents: 635, medCents: 149, dieCents: 31, swhCents: 0, netCents: 9433 },
  { employeeId: "L08", kind: "hourly", amountsCents: [21097], tipsCents: 13131, grossCents: 34228, oasdiCents: 2122, medCents: 496, dieCents: 103, swhCents: 0, netCents: 31507 },
  { employeeId: "L09", kind: "salary", amountsCents: [196208], tipsCents: 0, grossCents: 196208, oasdiCents: 12165, medCents: 2845, dieCents: 589, swhCents: 22342, netCents: 158267 },
  { employeeId: "L10", kind: "hourly", amountsCents: [16996], tipsCents: 74808, grossCents: 91804, oasdiCents: 5692, medCents: 1331, dieCents: 275, swhCents: 4006, netCents: 80500 },
  { employeeId: "L11", kind: "hourly", amountsCents: [3864], tipsCents: 12466, grossCents: 16330, oasdiCents: 1012, medCents: 237, dieCents: 49, swhCents: 0, netCents: 15032 },
  { employeeId: "L12", kind: "hourly", amountsCents: [11889], tipsCents: 52170, grossCents: 64059, oasdiCents: 3972, medCents: 929, dieCents: 192, swhCents: 2064, netCents: 56902 },
  { employeeId: "L13", kind: "hourly", amountsCents: [7615], tipsCents: 10622, grossCents: 18237, oasdiCents: 1131, medCents: 264, dieCents: 55, swhCents: 0, netCents: 16787 },
  { employeeId: "L14", kind: "hourly", amountsCents: [27456], tipsCents: 0, grossCents: 27456, oasdiCents: 1702, medCents: 398, dieCents: 82, swhCents: 0, netCents: 25274 },
  { employeeId: "L15", kind: "hourly", amountsCents: [11359], tipsCents: 47415, grossCents: 58774, oasdiCents: 3644, medCents: 852, dieCents: 176, swhCents: 1694, netCents: 52408 },
  { employeeId: "L16", kind: "hourly", amountsCents: [26444], tipsCents: 27911, grossCents: 54355, oasdiCents: 3370, medCents: 788, dieCents: 163, swhCents: 1385, netCents: 48649 },
];

export const FIXTURE_L_TOTALS = {
  grossCents: 1_057_039,
  oasdiCents: 65537,
  medCents: 15328,
  dieCents: 3171,
  swhCents: 54317,
  netCents: 918686,
};

export function fixtureLEmployees(): EmployeePayInput[] {
  return FIXTURE_L_ROWS.map((row) =>
    explicitEmployee({
      employeeId: row.employeeId,
      kind: row.kind,
      amountCents: row.amountsCents[0] ?? 0,
      extraAmountCents: row.amountsCents[1],
      tipsCents: row.tipsCents,
      exemptionCents: 0,
    }),
  );
}
