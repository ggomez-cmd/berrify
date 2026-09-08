import { describe, expect, it } from "vitest";
import {
  employeeHasOverlap,
  employeeWeekHours,
  filterShiftsForWeek,
  hoursBetween,
  isManager,
  shiftsOverlap,
  visibleShiftsForRole,
  weekStart,
} from "./schedule";

describe("isManager", () => {
  it("treats owner and manager as managers", () => {
    expect(isManager("owner")).toBe(true);
    expect(isManager("manager")).toBe(true);
    expect(isManager("staff")).toBe(false);
    expect(isManager(null)).toBe(false);
  });
});

describe("weekStart", () => {
  it("snaps to Sunday at midnight", () => {
    const wednesday = new Date(2026, 8, 9, 15, 30);
    const start = weekStart(wednesday);
    expect(start.getDay()).toBe(0);
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(6);
  });
});

describe("hoursBetween", () => {
  it("returns elapsed hours", () => {
    expect(hoursBetween("2026-09-06T16:00:00.000Z", "2026-09-06T21:00:00.000Z")).toBe(5);
  });
});

describe("shiftsOverlap", () => {
  it("detects overlapping ranges and ignores touching edges", () => {
    expect(
      shiftsOverlap(
        { starts_at: "2026-09-06T16:00:00.000Z", ends_at: "2026-09-06T21:00:00.000Z" },
        { starts_at: "2026-09-06T20:00:00.000Z", ends_at: "2026-09-06T23:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      shiftsOverlap(
        { starts_at: "2026-09-06T16:00:00.000Z", ends_at: "2026-09-06T21:00:00.000Z" },
        { starts_at: "2026-09-06T21:00:00.000Z", ends_at: "2026-09-06T23:00:00.000Z" },
      ),
    ).toBe(false);
  });
});

describe("employeeHasOverlap", () => {
  const existing = [
    {
      id: "a",
      employee_id: "e1",
      starts_at: "2026-09-06T16:00:00.000Z",
      ends_at: "2026-09-06T21:00:00.000Z",
    },
  ];

  it("flags the same employee overlapping another shift", () => {
    expect(
      employeeHasOverlap(existing, {
        id: "b",
        employee_id: "e1",
        starts_at: "2026-09-06T20:00:00.000Z",
        ends_at: "2026-09-06T23:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("ignores open shifts and other employees", () => {
    expect(
      employeeHasOverlap(existing, {
        id: "c",
        employee_id: null,
        starts_at: "2026-09-06T20:00:00.000Z",
        ends_at: "2026-09-06T23:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("employeeWeekHours", () => {
  it("sums hours for one employee", () => {
    expect(
      employeeWeekHours(
        [
          {
            employee_id: "e1",
            starts_at: "2026-09-06T16:00:00.000Z",
            ends_at: "2026-09-06T21:00:00.000Z",
          },
          {
            employee_id: "e1",
            starts_at: "2026-09-07T16:00:00.000Z",
            ends_at: "2026-09-07T20:00:00.000Z",
          },
          {
            employee_id: "e2",
            starts_at: "2026-09-06T16:00:00.000Z",
            ends_at: "2026-09-06T22:00:00.000Z",
          },
        ],
        "e1",
      ),
    ).toBe(9);
  });
});

describe("filterShiftsForWeek", () => {
  it("keeps shifts that start in the Sunday week", () => {
    const week = new Date(2026, 8, 9);
    const rows = [
      { starts_at: new Date(2026, 8, 6, 10).toISOString() },
      { starts_at: new Date(2026, 8, 13, 10).toISOString() },
    ];
    expect(filterShiftsForWeek(rows, week)).toHaveLength(1);
  });
});

describe("visibleShiftsForRole", () => {
  const shifts = [
    { status: "published" as const, employee_id: "me" },
    { status: "draft" as const, employee_id: "me" },
    { status: "published" as const, employee_id: "other" },
  ];

  it("lets managers see every shift", () => {
    expect(visibleShiftsForRole(shifts, "owner", "me")).toHaveLength(3);
  });

  it("lets staff see only their published shifts", () => {
    expect(visibleShiftsForRole(shifts, "staff", "me")).toEqual([
      { status: "published", employee_id: "me" },
    ]);
  });
});
