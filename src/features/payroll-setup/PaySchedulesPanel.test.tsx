import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaySchedulesPanel } from "./PaySchedulesPanel";

const mutateAsync = vi.fn().mockResolvedValue("sched-new");

vi.mock("../../auth/auth-context", () => ({
  useAuth: () => ({ org: { timezone: "America/Puerto_Rico" } }),
}));

vi.mock("../invoices/hooks", () => ({
  useRestaurants: () => ({
    data: [
      { id: "r-harbor", name: "Harbor" },
      { id: "r-inlet", name: "Inlet" },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./hooks", () => ({
  usePayrollEmployerSettings: () => ({ data: [], isLoading: false, error: null }),
  usePayrollPaySchedules: () => ({
    data: [
      {
        id: "s-1",
        org_id: "org-1",
        restaurant_id: "r-harbor",
        frequency: "weekly",
        anchor_period_start: "2026-10-27",
        check_lag_days: 5,
        taxes_via_provider: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    error: null,
  }),
  useUpsertPayrollPaySchedule: () => ({ mutateAsync, isPending: false }),
}));

describe("PaySchedulesPanel", () => {
  it("saves a new restaurant schedule from the empty state", async () => {
    render(<PaySchedulesPanel />);
    expect(screen.getByRole("heading", { name: "Harbor" })).toBeInTheDocument();
    expect(screen.getByText("No pay schedule yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    const inlet = screen.getByRole("heading", { name: "Inlet" }).closest("div");
    expect(inlet).toBeTruthy();
    const form = within(inlet as HTMLElement);
    fireEvent.change(form.getByLabelText("Frequency"), { target: { value: "biweekly" } });
    fireEvent.change(form.getByLabelText("First period start"), { target: { value: "2026-11-02" } });
    fireEvent.change(form.getByLabelText("Days from period end to check date"), {
      target: { value: "4" },
    });
    fireEvent.click(form.getByRole("checkbox", { name: "Taxes paid through payroll provider" }));
    fireEvent.click(form.getByRole("button", { name: "Save schedule" }));
    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: undefined,
        restaurant_id: "r-inlet",
        frequency: "biweekly",
        anchor_period_start: "2026-11-02",
        check_lag_days: 4,
        taxes_via_provider: false,
      });
    });
  });
});
