import { describe, expect, it } from "vitest";
import { formatWorked, summarizeShifts, weekRangeInZone } from "./my-shifts";

describe("my shifts helpers", () => {
  it("formats worked time in hours and minutes", () => {
    expect(formatWorked(0)).toBe("0 min");
    expect(formatWorked(45 * 60)).toBe("45 min");
    expect(formatWorked(7 * 3600)).toBe("7 h");
    expect(formatWorked(7.5 * 3600)).toBe("7 h 30 min");
    expect(formatWorked(-30)).toBe("0 min");
  });

  it("totals the shifts", () => {
    expect(
      summarizeShifts([
        { started_at: "2026-11-24T21:00:00Z", worked_seconds: 3 * 3600 },
        { started_at: "2026-11-25T21:00:00Z", worked_seconds: 2.5 * 3600 },
      ]),
    ).toEqual({ count: 2, workedSeconds: 5.5 * 3600 });
  });

  it("bounds the week at Puerto Rico midnight, not the phone's", () => {
    const { from, to } = weekRangeInZone(new Date(2026, 10, 22), "America/Puerto_Rico");
    expect(from.toISOString()).toBe("2026-11-22T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-29T04:00:00.000Z");
    // Saturday 10 p.m. in Puerto Rico is Sunday 02:00 UTC and still belongs to this week.
    const lateSaturday = new Date("2026-11-29T02:00:00Z");
    expect(lateSaturday >= from && lateSaturday < to).toBe(true);
  });
});
