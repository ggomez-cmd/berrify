import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthState } from "../../auth/auth-context";
import type { Organization } from "../../lib/types";
import { AppShell } from "./AppShell";

const org: Organization = {
  id: "org-1",
  name: "Pacifico Kitchen",
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

function renderShell(path = "/inventory", role: AuthState["role"] = "admin") {
  return render(
    <AuthContext.Provider value={{ ...auth, role }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Dashboard content</div>} />
            <Route path="/schedule" element={<div>Schedule content</div>} />
            <Route path="/inventory" element={<div>Inventory content</div>} />
            <Route path="/time-clock" element={<div>Time clock content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function drawer() {
  return document.querySelector<HTMLElement>('aside[aria-label="Navigation"]');
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
}

describe("AppShell mobile navigation", () => {
  it("opens the drawer from the menu button and closes after a nav link", () => {
    renderShell("/inventory");

    const nav = drawer();
    expect(nav).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");

    openMenu();
    expect(nav).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Close menu overlay" })).toBeInTheDocument();

    fireEvent.click(within(nav as HTMLElement).getByRole("link", { name: "Time Clock" }));
    expect(nav).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Time clock content")).toBeInTheDocument();
  });

  it("closes the drawer when the overlay is clicked", () => {
    renderShell("/inventory");
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Close menu overlay" }));
    expect(drawer()).toHaveAttribute("aria-hidden", "true");
  });

  it("lets managers see inventory but not the roster", () => {
    renderShell("/inventory", "manager");
    openMenu();
    const nav = drawer() as HTMLElement;
    expect(within(nav).getByRole("link", { name: "Inventory" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Invoices" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Kiosk" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Employees" })).toBeNull();
  });

  it("hides operations pages from staff", () => {
    renderShell("/schedule", "staff");
    openMenu();
    const nav = drawer() as HTMLElement;
    expect(within(nav).getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Time Clock" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Kiosk" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Inventory" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Invoices" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Employees" })).toBeNull();
  });
});
