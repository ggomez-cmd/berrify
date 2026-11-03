import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthState } from "../../auth/auth-context";
import { lastEndedPeriod } from "../../lib/payroll/schedules";
import type { Organization } from "../../lib/types";
import { PayrollRunEditorPage } from "./PayrollRunEditorPage";

const org: Organization = {
  id: "org-1",
  name: "Kitchen",
  created_at: "2026-01-01T00:00:00.000Z",
  timezone: "America/Puerto_Rico",
  workweek_start_dow: 0,
  workweek_start_time: "00:00",
  default_meal_break_paid: false,
  default_rest_break_paid: true,
};

const auth: AuthState = {
  session: { access_token: "test" } as AuthState["session"],
  user: { id: "user-1", email: "demo@berrify.local" } as AuthState["user"],
  org,
  role: "admin",
  loading: false,
  recovery: false,
  signOut: async () => undefined,
};

const harborSchedule = {
  id: "s-1",
  org_id: "org-1",
  restaurant_id: "r-harbor",
  frequency: "weekly" as const,
  anchor_period_start: "2026-10-27",
  check_lag_days: 5,
  taxes_via_provider: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const fixtures = vi.hoisted(() => ({
  employees: [] as Array<{ id: string; full_name: string }>,
  profiles: [] as Array<{ employee_id: string; employee_number: string | null; is_tipped: boolean; default_restaurant_id: string | null }>,
}));

function ok<T>(data: T) {
  return { data, isLoading: false, isSuccess: true, isFetching: false, error: null };
}

vi.mock("../employees/hooks", () => ({
  useEmployees: () => ok(fixtures.employees),
}));

vi.mock("../invoices/hooks", () => ({
  useRestaurants: () =>
    ok([
      { id: "r-harbor", name: "Harbor" },
      { id: "r-inlet", name: "Inlet" },
    ]),
}));

vi.mock("../payroll-setup/hooks", () => ({
  usePayrollEmployerSettings: () => ok([]),
  usePayrollEmployeeProfiles: () => ok(fixtures.profiles),
  usePayrollPayRates: () => ok([]),
  usePayrollRestaurantSalaries: () => ok([]),
  usePayrollCloverNames: () => ok([]),
  usePayrollPaySchedules: () => ok([harborSchedule]),
}));

vi.mock("./hooks", () => ({
  usePayrollRun: () => ({ data: undefined, isLoading: false, error: null }),
  usePayrollRunTimeEntries: () => ok({ timeEntries: [], timeBreaks: [], shiftRevision: "" }),
  usePayrollYtdBasis: () => ok({ revision: "", opening_balances: [], prior_check_taxes: [], prior_gross: [] }),
  useSavePayrollRunDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApprovePayrollRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDiscardPayrollRunDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("PayrollRunEditorPage", () => {
  it("prefills period dates from a restaurant pay schedule and disables restaurants without one", () => {
    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <PayrollRunEditorPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByRole("heading", { name: "All restaurants" })).toBeInTheDocument();
    const restaurant = screen.getByLabelText("Restaurant");
    expect(screen.getByRole("option", { name: "Harbor" })).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /Inlet — add a pay schedule in setup/ })).toBeDisabled();

    fireEvent.change(restaurant, { target: { value: "r-harbor" } });
    const expected = lastEndedPeriod(
      harborSchedule,
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(new Date()),
    );
    expect(screen.getByLabelText("Period start")).toHaveValue(expected.periodStart);
    expect(screen.getByLabelText("Period end")).toHaveValue(expected.periodEnd);
    expect(screen.getByLabelText("Check date")).toHaveValue(expected.checkDate);
    expect(screen.getByRole("heading", { name: "Harbor" })).toBeInTheDocument();
  });

  it("lists everyone at the restaurant for tips, tipped staff first", () => {
    fixtures.employees = [
      { id: "e-ana", full_name: "Ana" },
      { id: "e-bea", full_name: "Bea" },
      { id: "e-cruz", full_name: "Cruz" },
      { id: "e-dora", full_name: "Dora" },
    ];
    fixtures.profiles = [
      { employee_id: "e-ana", employee_number: null, is_tipped: false, default_restaurant_id: "r-harbor" },
      { employee_id: "e-bea", employee_number: null, is_tipped: false, default_restaurant_id: "r-inlet" },
      { employee_id: "e-cruz", employee_number: null, is_tipped: true, default_restaurant_id: "r-inlet" },
      { employee_id: "e-dora", employee_number: null, is_tipped: false, default_restaurant_id: "r-harbor" },
    ];
    try {
      render(
        <AuthContext.Provider value={auth}>
          <MemoryRouter>
            <PayrollRunEditorPage />
          </MemoryRouter>
        </AuthContext.Provider>,
      );
      fireEvent.change(screen.getByLabelText("Restaurant"), { target: { value: "r-harbor" } });
      const rows = screen
        .getAllByLabelText(/^Tips for /)
        .map((input) => input.getAttribute("aria-label")!.replace(/^Tips for (\w+),.*$/, "$1"));
      expect([...new Set(rows)]).toEqual(["Cruz", "Ana", "Dora"]);

      expect(screen.queryAllByLabelText(/^Tips for Bea/)).toHaveLength(0);

      // A tip already entered (org-wide here) keeps its row after switching to a restaurant they aren't at.
      fireEvent.change(screen.getByLabelText("Restaurant"), { target: { value: "" } });
      fireEvent.change(screen.getAllByLabelText(/^Tips for Bea/)[0]!, { target: { value: "10" } });
      fireEvent.change(screen.getByLabelText("Restaurant"), { target: { value: "r-harbor" } });
      expect(screen.getAllByLabelText(/^Tips for Bea/)[0]).toHaveValue("10");
    } finally {
      fixtures.employees = [];
      fixtures.profiles = [];
    }
  });

  it("prefills from the employer's local date, not UTC, in the evening", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Monday Nov 2, 8:30 p.m. in Puerto Rico is already Tuesday Nov 3 in UTC.
    vi.setSystemTime(new Date("2026-11-03T00:30:00.000Z"));
    try {
      render(
        <AuthContext.Provider value={auth}>
          <MemoryRouter>
            <PayrollRunEditorPage />
          </MemoryRouter>
        </AuthContext.Provider>,
      );
      fireEvent.change(screen.getByLabelText("Restaurant"), { target: { value: "r-harbor" } });
      // Nov 2 is the last day of the Oct 27 – Nov 2 period, so the last ended period is Oct 20–26.
      expect(screen.getByLabelText("Period start")).toHaveValue("2026-10-20");
      expect(screen.getByLabelText("Period end")).toHaveValue("2026-10-26");
      expect(screen.getByLabelText("Check date")).toHaveValue("2026-10-31");
    } finally {
      vi.useRealTimers();
    }
  });
});
