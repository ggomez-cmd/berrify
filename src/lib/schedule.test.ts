import { describe, expect, it } from "vitest";
import {
  ALL_RESTAURANTS,
  atTimeOnDay,
  composeShiftRangeOnDay,
  employeeHasOverlap,
  employeeWeekHours,
  employeesForRestaurant,
  filterShiftsForWeek,
  groupEmployeesByRestaurant,
  hoursBetween,
  isAdmin,
  isManager,
  shiftRestaurantId,
  shiftsForRestaurant,
  shiftsOverlap,
  visibleShiftsForRole,
  weekStart,
} from "./schedule";

describe("isAdmin", () => {
  it("treats only admin as admin", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("manager")).toBe(false);
    expect(isAdmin("staff")).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe("isManager", () => {
  it("treats admin and manager as managers", () => {
    expect(isManager("admin")).toBe(true);
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
    expect(visibleShiftsForRole(shifts, "admin", "me")).toHaveLength(3);
  });

  it("lets staff see only their published shifts", () => {
    expect(visibleShiftsForRole(shifts, "staff", "me")).toEqual([
      { status: "published", employee_id: "me" },
    ]);
  });
});

describe("composeShiftRangeOnDay", () => {
  it("composes 16:00–22:00 on the locked local day", () => {
    const day = new Date(2026, 8, 13);
    const { starts_at, ends_at } = composeShiftRangeOnDay(day, "16:00", "22:00");
    expect(new Date(starts_at)).toEqual(atTimeOnDay(day, 16, 0));
    expect(new Date(ends_at)).toEqual(atTimeOnDay(day, 22, 0));
  });

  it("places an overnight end on the next calendar day", () => {
    const day = new Date(2026, 8, 13);
    const { starts_at, ends_at } = composeShiftRangeOnDay(day, "22:00", "02:00");
    const starts = new Date(starts_at);
    const ends = new Date(ends_at);
    expect(starts).toEqual(atTimeOnDay(day, 22, 0));
    expect(ends.getFullYear()).toBe(2026);
    expect(ends.getMonth()).toBe(8);
    expect(ends.getDate()).toBe(14);
    expect(ends.getHours()).toBe(2);
    expect(ends.getMinutes()).toBe(0);
  });
});

describe("restaurant grouping", () => {
  const employees = [
    { id: "e1", home_restaurant_id: "r1" },
    { id: "e2", home_restaurant_id: "r2" },
    { id: "e3", home_restaurant_id: null },
    { id: "e4", home_restaurant_id: "gone" },
  ];
  const restaurants = [
    { id: "r1", name: "Semilla" },
    { id: "r2", name: "Lelas" },
    { id: "r3", name: "Empty" },
  ];

  it("resolves a shift's restaurant from the shift, then the employee's home", () => {
    expect(shiftRestaurantId({ restaurant_id: "r2", employee_id: "e1" }, employees)).toBe("r2");
    expect(shiftRestaurantId({ restaurant_id: null, employee_id: "e1" }, employees)).toBe("r1");
    expect(shiftRestaurantId({ restaurant_id: null, employee_id: null }, employees)).toBeNull();
    expect(shiftRestaurantId({ restaurant_id: null, employee_id: "missing" }, employees)).toBeNull();
  });

  it("filters shifts and employees to one restaurant, or keeps all", () => {
    const shifts = [
      { id: "a", restaurant_id: null, employee_id: "e1" },
      { id: "b", restaurant_id: "r1", employee_id: null },
      { id: "c", restaurant_id: "r1", employee_id: "e2" },
      { id: "d", restaurant_id: null, employee_id: "e2" },
      { id: "e", restaurant_id: null, employee_id: null },
    ];
    expect(shiftsForRestaurant(shifts, employees, "r1").map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(shiftsForRestaurant(shifts, employees, ALL_RESTAURANTS)).toHaveLength(5);
    expect(employeesForRestaurant(employees, "r2").map((e) => e.id)).toEqual(["e2"]);
    expect(employeesForRestaurant(employees, ALL_RESTAURANTS)).toHaveLength(4);
  });

  it("groups employees by restaurant order and puts the rest last", () => {
    const groups = groupEmployeesByRestaurant(employees, restaurants);
    expect(groups.map((g) => g.restaurant?.name ?? null)).toEqual(["Semilla", "Lelas", null]);
    expect(groups[2].employees.map((e) => e.id)).toEqual(["e3", "e4"]);
  });
});
