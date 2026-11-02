import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthState } from "../../auth/auth-context";
import type { Organization } from "../../lib/types";
import { ReviewShiftsPage } from "./ReviewShiftsPage";

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
  role: "manager",
  loading: false,
  recovery: false,
  signOut: async () => undefined,
};

vi.mock("../employees/hooks", () => ({
  useEmployees: () => ({
    data: [{ id: "emp-1", full_name: "Ada Clerk", position: "Server", user_id: "user-1", home_restaurant_id: "r-1" }],
  }),
}));

vi.mock("../invoices/hooks", () => ({
  useRestaurants: () => ({
    data: [{ id: "r-1", name: "Semilla" }],
  }),
}));

vi.mock("./hooks", () => ({
  useTimeEntryReview: () => ({
    data: {
      entries: [
        {
          id: "e-1",
          org_id: "org-1",
          employee_id: "emp-1",
          staff_shift_id: null,
          restaurant_id: "r-1",
          position: "Server",
          started_at: "2026-10-02T13:00:00.000Z",
          ended_at: "2026-10-02T21:00:00.000Z",
          gross_seconds: 28800,
          paid_break_seconds: 0,
          unpaid_break_seconds: 0,
          worked_seconds: 28800,
          status: "pending",
          created_at: "2026-10-02T21:00:00.000Z",
          updated_at: "2026-10-02T21:00:00.000Z",
        },
      ],
      breaks: [],
      exceptions: [],
      edits: [],
      windows: [],
    },
    isLoading: false,
    error: null,
  }),
  useSaveTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVoidTimeEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage(role: AuthState["role"] = "manager") {
  return render(
    <AuthContext.Provider value={{ ...auth, role }}>
      <MemoryRouter initialEntries={["/time-clock/shifts?start=2026-10-01&end=2026-10-08"]}>
        <Routes>
          <Route path="/time-clock/shifts" element={<ReviewShiftsPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ReviewShiftsPage", () => {
  it("groups a loaded shift by employee and offers add/edit/void", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Review shifts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ada Clerk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
  });

  it("hides the review from staff", () => {
    renderPage("staff");
    expect(screen.getByText(/limited to managers and admins/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add shift" })).not.toBeInTheDocument();
  });
});
