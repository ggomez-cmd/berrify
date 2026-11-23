import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShiftWithEmployee } from "../../lib/types";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("../../auth/auth-context", () => ({ useAuth: () => ({ role: "staff" }) }));
vi.mock("./hooks", () => ({
  useShifts: () => ({ data: [] }),
  usePublishWeek: () => ({}),
  useShiftCoworkers: () => ({ data: new Map([["luis", "Luis"]]) }),
}));

import { StaffSchedule } from "./SchedulePage";

const monday = new Date(2026, 10, 23);
const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 23 + i));

function shift(id: string, employeeId: string, day: number, name: string): ShiftWithEmployee {
  return {
    id,
    employee_id: employeeId,
    restaurant_id: "kane",
    position: "Server",
    status: "published",
    starts_at: new Date(2026, 10, day, 17).toISOString(),
    ends_at: new Date(2026, 10, day, 23).toISOString(),
    note: null,
    employees: { full_name: name },
  } as unknown as ShiftWithEmployee;
}

function renderWith(shifts: ShiftWithEmployee[]) {
  return render(
    <StaffSchedule
      weekDays={weekDays}
      weekShifts={shifts}
      restaurants={[{ id: "kane", name: "Kane Rum Bar" }]}
      myEmployeeId="me"
      cursor={monday}
      setCursor={() => {}}
      isLoading={false}
      error={null}
    />,
  );
}

describe("StaffSchedule", () => {
  it("shows only the days the employee works, with coworkers on those days", () => {
    renderWith([
      shift("a", "me", 24, "Rey"),
      shift("b", "luis", 24, "Luis"),
      shift("c", "luis", 25, "Luis"),
    ]);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/Tuesday/);
    expect(screen.getByText("Also on: Luis")).toBeTruthy();
    expect(screen.queryByText(/No published shifts/)).toBeNull();
  });

  it("says so when the employee has no shifts that week", () => {
    renderWith([shift("c", "luis", 25, "Luis")]);
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.getByText("No published shifts for you this week.")).toBeTruthy();
  });
});

describe("StaffSchedule without a roster row", () => {
  it("does not show open shifts as the employee's own", () => {
    const open = { ...shift("o", "x", 26, "Open"), employee_id: null } as unknown as ShiftWithEmployee;
    render(
      <StaffSchedule
        weekDays={weekDays}
        weekShifts={[open]}
        restaurants={[]}
        myEmployeeId={null}
        cursor={monday}
        setCursor={() => {}}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });
});
