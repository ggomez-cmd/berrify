import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  me: { id: "e1" } as { id: string } | null,
  session: null as Record<string, string | null> | null,
  entries: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ id: string | null; from: Date; to: Date }>,
}));

vi.mock("../../auth/auth-context", () => ({ useAuth: () => ({ org: { timezone: "America/Puerto_Rico" } }) }));
vi.mock("../employees/hooks", () => ({ useMyEmployee: () => ({ data: state.me, isLoading: false }) }));
vi.mock("../invoices/hooks", () => ({ useRestaurants: () => ({ data: [{ id: "kane", name: "Kane Rum Bar" }] }) }));
vi.mock("../time-clock/hooks", () => ({
  useMyClockSession: () => ({ data: state.session }),
  useMyTimeEntries: (id: string | null, from: Date, to: Date) => {
    state.calls.push({ id, from, to });
    return { data: state.entries, isLoading: false, error: null };
  },
}));

import { MyShiftsPage } from "./MyShiftsPage";

const entry = (id: string, start: string, end: string, worked: number, extra: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: "kane",
  position: "Server",
  started_at: start,
  ended_at: end,
  worked_seconds: worked,
  unpaid_break_seconds: 0,
  status: "pending",
  ...extra,
});

describe("MyShiftsPage", () => {
  beforeEach(() => {
    state.me = { id: "e1" };
    state.session = null;
    state.entries = [];
    state.calls = [];
  });

  it("lists completed shifts for the signed-in employee with a weekly total", () => {
    state.entries = [
      entry("a", "2026-11-25T01:00:00Z", "2026-11-25T04:00:00Z", 3 * 3600),
      entry("b", "2026-11-26T01:00:00Z", "2026-11-26T04:30:00Z", 3 * 3600, {
        unpaid_break_seconds: 30 * 60,
        status: "exception",
      }),
    ];
    render(<MyShiftsPage />);
    expect(state.calls[state.calls.length - 1]?.id).toBe("e1");
    expect(screen.getByText("2 shifts · 6 h worked")).toBeTruthy();
    expect(screen.getAllByText("Kane Rum Bar · Server")).toHaveLength(2);
    expect(screen.getByText("30 min unpaid break")).toBeTruthy();
    expect(screen.getByText("Under review")).toBeTruthy();
  });

  it("offers no clock buttons and points to the kiosk", () => {
    render(<MyShiftsPage />);
    expect(screen.getByText("Off the clock")).toBeTruthy();
    expect(screen.getByText("Clock in and out at the kiosk.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /clock in|clock out|break/i })).toBeNull();
    expect(screen.getByText("No completed shifts this week.")).toBeTruthy();
  });

  it("shows when the employee is on the clock", () => {
    state.session = { state: "working", clocked_in_at: "2026-11-23T21:05:00Z", break_started_at: null };
    render(<MyShiftsPage />);
    expect(screen.getByText(/On the clock since/)).toBeTruthy();
  });

  it("explains an unlinked login", () => {
    state.me = null;
    render(<MyShiftsPage />);
    expect(screen.getByText(/not linked to the roster/)).toBeTruthy();
  });
});
