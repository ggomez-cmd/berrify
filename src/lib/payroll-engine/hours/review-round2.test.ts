import { describe, expect, it } from "vitest";
import { parseCloverShifts } from "./clover";
import { buildHourlyWeeks } from "./rates";
import { splitHours } from "./split";
import { resolveZonedInstant } from "./time";
import type { WorkedShift } from "./types";

describe("phase 2 review round 2", () => {
  it("rejects tips when the run's workweeks are not given", () => {
    const result = buildHourlyWeeks({
      shifts: [],
      allocations: [],
      timeZone: "America/Puerto_Rico",
      rates: [{ employeeId: "E1", positionKey: "main", rateCents: 1100, effectiveFrom: "2026-01-01" }],
      tips: [{ employeeId: "E1", workweekId: "2030-01-01", tipsCents: 12_345 }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.weeks.size).toBe(0);
  });

  it("warns on an ambiguous fall-back break: 00:00–03:00 with unpaid 01:30–02:00 in New York", () => {
    const csv = [
      "Cafe",
      "Payroll Period,2026-11-01 To 2026-11-01",
      "Name,Clock in date,Clock in time,Clock out date,Clock out time,Break start,Break end,Break length,Break type",
      "Pat,2026-11-01,00:00,2026-11-01,03:00,01:30,02:00,30 min,30 min - Unpaid",
    ].join("\n");
    const parsed = parseCloverShifts({
      csv,
      timeZone: "America/New_York",
      mapping: { Pat: { employeeId: "P1", positionKey: "cook", classId: "r1" } },
      ignore: [],
    });
    expect(parsed.report.warnings.some((warning) => warning.includes("ambiguous local break time"))).toBe(true);
  });

  it("splits a Havana shift in a week whose next midnight does not exist (2026-03-08 00:00)", () => {
    const shift: WorkedShift = {
      id: "s1",
      employeeId: "E1",
      positionKey: "main",
      classId: "r1",
      startedAt: "2026-03-07T14:00:00.000Z",
      endedAt: "2026-03-07T22:00:00.000Z",
      breaks: [],
      source: "time_clock",
    };
    const result = splitHours([shift], {
      timeZone: "America/Havana",
      workweekStartDow: 0,
      workweekStartTime: "00:00",
      dailyWindow: "calendar_day",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-14",
    });
    expect(result.errors).toEqual([]);
    const regular = result.allocations.reduce((sum, row) => sum + row.regularSeconds, 0);
    expect(regular).toBe(8 * 3600);
  });

  it("resolves Havana 2026-03-08 00:30 to the first instant after the gap", () => {
    const resolved = resolveZonedInstant(
      { year: 2026, month: 3, day: 8, hour: 0, minute: 30, second: 0, timeZone: "America/Havana" },
      { onNonexistent: "after_gap" },
    );
    expect(resolved.nonexistent).toBe(true);
    expect(resolved.seconds).toBe(Date.parse("2026-03-08T05:00:00.000Z") / 1000);
  });
});
