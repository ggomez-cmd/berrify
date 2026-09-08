import { describe, expect, it } from "vitest";
import { DEMO_FILL_NOTE, astStamp, demoWeekShifts } from "./demo-fill";
import { hoursBetween, weekStart } from "./schedule";

describe("demoWeekShifts", () => {
  const around = new Date("2026-09-08T12:00:00-04:00");
  const rows = demoWeekShifts(around);

  it("covers the visible week with published, draft, and open shifts", () => {
    expect(rows.some((row) => row.status === "published")).toBe(true);
    expect(rows.some((row) => row.status === "draft")).toBe(true);
    expect(rows.some((row) => row.email === null)).toBe(true);
    expect(rows.every((row) => row.note.startsWith(DEMO_FILL_NOTE))).toBe(true);
  });

  it("stays inside the Sunday–Saturday board week", () => {
    const start = weekStart(around).getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    for (const row of rows) {
      const at = new Date(row.startsAt).getTime();
      expect(at).toBeGreaterThanOrEqual(start);
      expect(at).toBeLessThan(end);
      expect(hoursBetween(row.startsAt, row.endsAt)).toBeGreaterThan(0);
    }
  });

  it("formats Puerto Rico wall times as AST", () => {
    expect(astStamp(2026, 9, 8, 16)).toBe("2026-09-08T16:00:00-04:00");
  });
});
