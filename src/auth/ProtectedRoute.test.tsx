import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthState } from "./auth-context";
import { ProtectedRoute } from "./ProtectedRoute";

const auth: AuthState = {
  session: { access_token: "test" } as AuthState["session"],
  user: { id: "user-1" } as AuthState["user"],
  org: null,
  role: "admin",
  loading: false,
  recovery: false,
  signOut: async () => undefined,
};

function renderAt(path: string, role: AuthState["role"]) {
  return render(
    <AuthContext.Provider value={{ ...auth, role }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/kiosk" element={<div>Kiosk page</div>} />
            <Route path="/" element={<div>Dashboard page</div>} />
            <Route path="/schedule" element={<div>Schedule page</div>} />
            <Route path="/payroll" element={<div>Payroll page</div>} />
            <Route path="/employees" element={<div>Employees page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ProtectedRoute kiosk lock", () => {
  it.each(["/", "/schedule", "/payroll", "/employees"])("sends a kiosk login from %s to the kiosk", (path) => {
    renderAt(path, "kiosk");
    expect(screen.getByText("Kiosk page")).toBeInTheDocument();
  });

  it("keeps a kiosk login on the kiosk", () => {
    renderAt("/kiosk", "kiosk");
    expect(screen.getByText("Kiosk page")).toBeInTheDocument();
  });

  it.each(["admin", "manager", "staff"] as const)("leaves %s where they asked to go", (role) => {
    renderAt("/schedule", role);
    expect(screen.getByText("Schedule page")).toBeInTheDocument();
  });
});
