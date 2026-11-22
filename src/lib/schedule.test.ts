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
  shiftsForRestaurant,
  shiftsOverlap,
  staffAlsoOn,
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

  it("filters shifts and employees to one restaurant, or keeps all", () => {
    const shifts = [
      { id: "a", restaurant_id: null, employee_id: "e1" },
      { id: "b", restaurant_id: "r1", employee_id: null },
      { id: "c", restaurant_id: "r1", employee_id: "e2" },
      { id: "d", restaurant_id: null, employee_id: "e2" },
      { id: "e", restaurant_id: null, employee_id: null },
    ];
    expect(shiftsForRestaurant(shifts, "r1").map((s) => s.id)).toEqual(["b", "c"]);
    expect(shiftsForRestaurant(shifts, ALL_RESTAURANTS)).toHaveLength(5);
    expect(employeesForRestaurant(employees, "r2").map((e) => e.id)).toEqual(["e2"]);
    expect(employeesForRestaurant(employees, ALL_RESTAURANTS)).toHaveLength(4);
  });

  it("groups employees by restaurant order and puts the rest last", () => {
    const groups = groupEmployeesByRestaurant(employees, restaurants);
    expect(groups.map((g) => g.restaurant?.name ?? null)).toEqual(["Semilla", "Lelas", null]);
    expect(groups[2].employees.map((e) => e.id)).toEqual(["e3", "e4"]);
  });
});

describe("staffAlsoOn", () => {
  const day = new Date(2031, 2, 3);
  const at = (hour: number, d = 3) => new Date(2031, 2, d, hour).toISOString();
  const names = new Map([
    ["e2", "Ana"],
    ["e3", "Luis"],
  ]);
  const shift = (employee_id: string | null, restaurant_id: string | null, starts_at = at(16)) => ({
    employee_id,
    restaurant_id,
    starts_at,
    status: "published" as const,
  });

  it("names coworkers at the restaurant I work that day", () => {
    const shifts = [shift("me", "A"), shift("e2", "A", at(18)), shift("e3", "B")];
    expect(staffAlsoOn(shifts, day, "me", names)).toEqual(["Ana"]);
  });

  it("labels open shifts and unnamed coworkers", () => {
    const shifts = [shift("me", "A"), shift(null, "A"), shift("e9", "A")];
    expect(staffAlsoOn(shifts, day, "me", names)).toEqual(["Open", "Coworker"]);
  });

  it("is empty on days I do not work, or with no employee", () => {
    const shifts = [shift("e2", "A"), shift(null, "A")];
    expect(staffAlsoOn(shifts, day, "me", names)).toEqual([]);
    expect(staffAlsoOn(shifts, day, null, names)).toEqual([]);
  });

  it("ignores drafts and other days", () => {
    const shifts = [
      shift("me", "A"),
      { ...shift("e2", "A"), status: "draft" as const },
      shift("e3", "A", at(16, 4)),
    ];
    expect(staffAlsoOn(shifts, day, "me", names)).toEqual([]);
  });

  it("does not scope by restaurant when my shift has none", () => {
    const shifts = [shift("me", null), shift("e2", "A"), shift("e3", "B")];
    expect(staffAlsoOn(shifts, day, "me", names)).toEqual(["Ana", "Luis"]);
  });
});
