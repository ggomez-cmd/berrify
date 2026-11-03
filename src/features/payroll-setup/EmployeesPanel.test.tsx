import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Employee, PayrollEmployeeProfileRow } from "../../lib/types";
import { EmployeePayrollDialog } from "./EmployeesPanel";

const timestamps = {
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const employee: Employee = {
  id: "emp-1",
  org_id: "org-1",
  user_id: null,
  full_name: "Ada Clerk",
  email: null,
  phone: null,
  position: "Cook",
  login_role: "staff",
  hourly_rate: 15,
  home_restaurant_id: "r-harbor",
  invite_code: null,
  active: true,
  ...timestamps,
};

const profile: PayrollEmployeeProfileRow = {
  id: "p1",
  org_id: "org-1",
  employee_id: "emp-1",
  employee_number: "E-1",
  pay_type: "payroll",
  is_tipped: false,
  hire_date: null,
  daily_ot_multiplier_ppm: 1_500_000,
  weekly_ot_multiplier_ppm: 1_500_000,
  default_restaurant_id: "r-harbor",
  salary_cents: 190_000,
  personal_exemption: "none",
  veteran: false,
  dependents: 0,
  reduced_dependents: 0,
  deduction_cents: 0,
  annual_exemption_override_cents: null,
  biweekly_exemption_override_cents: null,
  young_worker_exempt: false,
  additional_withholding_cents: 0,
  fixed_swh_cents: null,
  payment_method: null,
  r41_effective_date: null,
  notes: null,
  ...timestamps,
};

vi.mock("../invoices/hooks", () => ({
  useRestaurants: () => ({
    data: [
      { id: "r-harbor", name: "Harbor" },
      { id: "r-inlet", name: "Inlet" },
    ],
  }),
}));

vi.mock("./hooks", () => ({
  useSavePayrollEmployeeSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("EmployeePayrollDialog", () => {
  it("adds a salary-at-other-restaurants row and hides the default restaurant", () => {
    render(
      <EmployeePayrollDialog
        employee={employee}
        profile={profile}
        rates={[]}
        restaurantSalaries={[]}
        setupReady
        loadError={null}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Salary at other restaurants" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add salary" }));
    expect(screen.getByLabelText("Salary per check")).toBeInTheDocument();
    const restaurant = screen.getByLabelText("Salary restaurant");
    expect([...restaurant.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Select restaurant",
      "Inlet",
    ]);
  });
});
