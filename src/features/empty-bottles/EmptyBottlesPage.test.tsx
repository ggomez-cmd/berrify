import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthState } from "../../auth/auth-context";
import type { Organization } from "../../lib/types";
import { EmptyBottlesPage } from "./EmptyBottlesPage";

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

vi.mock("../invoices/hooks", () => ({
  useRestaurants: () => ({
    data: [{ id: "r-1", name: "Semilla", qbo_company_name: "Semilla", slug: "semilla" }],
  }),
  fileToDataUrl: async () => ({ data: "data:image/jpeg;base64,xx", mime: "image/jpeg" }),
}));

vi.mock("./hooks", () => ({
  useEmptyBottleEvents: () => ({
    data: [
      {
        id: "e-1",
        org_id: "org-1",
        telegram_message_id: null,
        chat_id: null,
        restaurant_id: "r-1",
        proposed_item_id: null,
        proposed_label: "11 bottles",
        status: "pending",
        source: "app",
        image_data: null,
        image_mime: "image/jpeg",
        vision_count: 11,
        gemini_count: 9,
        created_at: "2026-09-18T00:00:00.000Z",
        restaurants: { id: "r-1", name: "Semilla" },
        empty_bottle_lines: [
          {
            id: "l-1",
            event_id: "e-1",
            org_id: "org-1",
            proposed_item_id: "i-wine",
            proposed_label: "Wine",
            qty: 1,
            sort: 0,
          },
        ],
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useEmptyBottleCatalog: () => ({ data: [{ id: "i-wine", name: "Wine", sku: "BV-EB-WINE" }] }),
  useEmptyBottleMedia: () => ({ data: { image_data: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", image_mime: "image/gif" }, isLoading: false }),
  useSaveEmptyBottleReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmEmptyBottle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelEmptyBottle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage(role: AuthState["role"] = "admin") {
  return render(
    <AuthContext.Provider value={{ ...auth, role }}>
      <MemoryRouter initialEntries={["/empty-bottles"]}>
        <Routes>
          <Route path="/empty-bottles" element={<EmptyBottlesPage />} />
          <Route path="/schedule" element={<div>Schedule content</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("EmptyBottlesPage", () => {
  it("sends staff away from the manager page", () => {
    renderPage("staff");
    expect(screen.getByText("Schedule content")).toBeInTheDocument();
  });

  it("lists a mismatch badge and opens the Review line table for managers", () => {
    renderPage("manager");
    expect(screen.getByText("11 bottles")).toBeInTheDocument();
    expect(screen.getByText("Mismatch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Vision counted 11. Gemini counted 9.", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Label 1")).toHaveValue("Wine");
    expect(screen.getByRole("button", { name: "Confirm debit" })).toBeInTheDocument();
  });
});
