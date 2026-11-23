import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { canSendInvite, loginState, sendEmployeeInvite } from "./employee-invite";
import type { Employee } from "./types";

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    org_id: "org-1",
    user_id: null,
    full_name: "Ana Server",
    email: "ana@example.com",
    phone: null,
    position: "Server",
    login_role: "staff",
    hourly_rate: 10.5,
    home_restaurant_id: null,
    invite_code: "abc",
    active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("loginState", () => {
  it("covers each roster state", () => {
    expect(loginState(employee(), undefined)).toBe("not-invited");
    expect(loginState(employee({ email: null }), undefined)).toBe("no-email");
    expect(loginState(employee({ active: false }), undefined)).toBe("inactive");
    const invited = { employee_id: "emp-1", invited_at: "2026-11-17T00:00:00Z", last_sign_in_at: null };
    expect(loginState(employee({ user_id: "u1" }), invited)).toBe("invited");
    expect(
      loginState(employee({ user_id: "u1" }), { ...invited, last_sign_in_at: "2026-11-17T01:00:00Z" }),
    ).toBe("linked");
    expect(loginState(employee({ user_id: "u1" }), undefined)).toBe("linked");
  });

  it("offers Send invite only to active employees with an email who are not signed in", () => {
    expect(canSendInvite(employee(), "not-invited")).toBe(true);
    expect(canSendInvite(employee({ user_id: "u1" }), "invited")).toBe(true);
    expect(canSendInvite(employee({ user_id: "u1" }), "linked")).toBe(false);
    expect(canSendInvite(employee({ active: false, user_id: "u1" }), "invited")).toBe(false);
  });
});

describe("sendEmployeeInvite", () => {
  it("posts with the session token and returns the status", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true, status: "resent" }));
    const status = await sendEmployeeInvite("emp-1", fetchImpl as unknown as typeof fetch, async () => "tok");
    expect(status).toBe("resent");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/employees/emp-1/invite",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    );
  });

  it("surfaces the server error message", async () => {
    const fetchImpl = async () => Response.json({ error: "This email already has a Berrify login." }, { status: 409 });
    await expect(sendEmployeeInvite("emp-1", fetchImpl, async () => "tok")).rejects.toThrow(
      "This email already has a Berrify login.",
    );
  });
});
