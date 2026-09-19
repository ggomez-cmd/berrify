import { describe, expect, it } from "vitest";
import { handleDownloadQwc, parseManagerPath, requireManager } from "./qbwc-manager";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

function managerRequest(origin = "https://berrify.example"): Request {
  return new Request("https://berrify.example/api/qbwc/connections", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    },
  });
}

describe("QBWC manager routes", () => {
  it("parses create, rotate, revoke, and qwc paths", () => {
    expect(parseManagerPath("/api/qbwc/connections")).toEqual({ kind: "create" });
    expect(parseManagerPath("/api/qbwc/connections/abc/rotate")).toEqual({ kind: "rotate", id: "abc" });
    expect(parseManagerPath("/api/qbwc/connections/abc/revoke")).toEqual({ kind: "revoke", id: "abc" });
    expect(parseManagerPath("/api/qbwc/connections/abc/qwc")).toEqual({ kind: "qwc", id: "abc" });
    expect(parseManagerPath("/api/qbwc")).toBeNull();
  });

  it("rejects staff and other-origin callers", async () => {
    const staffFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user-1" });
      if (url.includes("/rest/v1/memberships")) return Response.json([{ org_id: "org-1", role: "staff" }]);
      throw new Error(url);
    };
    const denied = await requireManager(managerRequest(), env, staffFetch);
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);

    const crossOrigin = await requireManager(
      managerRequest("https://evil.example"),
      env,
      async () => Response.json({ id: "user-1" }),
    );
    expect(crossOrigin).toBeInstanceOf(Response);
    expect((crossOrigin as Response).status).toBe(401);
  });

  it("accepts a manager in their org", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user-1" });
      if (url.includes("/rest/v1/memberships")) return Response.json([{ org_id: "org-1", role: "manager" }]);
      throw new Error(url);
    };
    const allowed = await requireManager(managerRequest(), env, fetchImpl);
    expect(allowed).toEqual({ userId: "user-1", orgId: "org-1", role: "manager" });
  });

  it("does not download another org's qwc", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("quickbooks_desktop_connections")) {
        expect(url).toContain("org_id=eq.org-1");
        return Response.json([]);
      }
      throw new Error(url);
    };
    const response = await handleDownloadQwc(
      env,
      { userId: "user-1", orgId: "org-1", role: "manager" },
      "conn-other-org",
      fetchImpl,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("OwnerID");
  });
});
