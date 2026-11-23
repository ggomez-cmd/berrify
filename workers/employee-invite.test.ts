import { describe, expect, it } from "vitest";
import { handleEmployeeInvite, parseInvitePath } from "./employee-invite";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};
const EMP = "11111111-2222-3333-4444-555555555555";
const PATH = `/api/employees/${EMP}/invite`;

function inviteRequest(origin = "https://berrify.app"): Request {
  return new Request(`https://berrify.app${PATH}`, {
    method: "POST",
    headers: { Origin: origin, Authorization: "Bearer user-token" },
  });
}

type Employee = {
  id: string;
  email: string | null;
  user_id: string | null;
  active: boolean;
  invite_code: string | null;
};

function fakeSupabase(opts: {
  role?: string;
  employee?: Partial<Employee> | null;
  authUser?: Record<string, unknown>;
  inviteStatus?: number;
  inviteBody?: unknown;
  linkAfterInvite?: boolean;
  existingUsers?: Array<{ email: string }> | ((page: number) => Array<{ email: string }> | Response);
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let employee: Employee | null =
    opts.employee === null
      ? null
      : {
          id: EMP,
          email: "Server@Example.com",
          user_id: null,
          active: true,
          invite_code: "abc123",
          ...opts.employee,
        };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "admin-1" });
    if (url.includes("/rest/v1/memberships")) {
      return Response.json([{ org_id: "org-1", role: opts.role ?? "admin" }]);
    }
    if (url.includes("/rest/v1/employees")) return Response.json(employee ? [employee] : []);
    if (url.includes("/auth/v1/admin/users/")) return Response.json(opts.authUser ?? {});
    if (url.includes("/auth/v1/admin/users?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      const users = typeof opts.existingUsers === "function" ? opts.existingUsers(page) : (opts.existingUsers ?? []);
      return users instanceof Response ? users : Response.json({ users });
    }
    if (url.includes("/auth/v1/invite")) {
      const status = opts.inviteStatus ?? 200;
      if (status === 200 && employee && opts.linkAfterInvite !== false) {
        employee = { ...employee, user_id: employee.user_id ?? "new-user", invite_code: null };
      }
      return Response.json(opts.inviteBody ?? {}, { status });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}

async function run(opts: Parameters<typeof fakeSupabase>[0], request = inviteRequest()) {
  const fake = fakeSupabase(opts);
  const response = (await handleEmployeeInvite(request, env, PATH, fake.fetchImpl))!;
  return { response, body: (await response.json()) as Record<string, unknown>, calls: fake.calls };
}

describe("employee invite route", () => {
  it("only matches the invite path", () => {
    expect(parseInvitePath(PATH)).toBe(EMP);
    expect(parseInvitePath("/api/employees/not-a-uuid/invite")).toBeNull();
    expect(parseInvitePath(`/api/employees/${EMP}`)).toBeNull();
  });

  it("sends an invite with the invite code and accept-invite redirect", async () => {
    const { response, body, calls } = await run({});
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "sent" });
    const lookup = calls.find((c) => c.url.includes("/rest/v1/employees"))!;
    expect(lookup.url).toContain("org_id=eq.org-1");
    const invite = calls.find((c) => c.url.includes("/auth/v1/invite"))!;
    expect(new URL(invite.url).searchParams.get("redirect_to")).toBe("https://berrify.app/accept-invite");
    expect(JSON.parse(String(invite.init?.body))).toEqual({
      email: "server@example.com",
      data: { invite_code: "abc123" },
    });
  });

  it("rejects managers, staff, and other origins", async () => {
    expect((await run({ role: "manager" })).response.status).toBe(403);
    expect((await run({ role: "staff" })).response.status).toBe(403);
    expect((await run({}, inviteRequest("https://evil.example"))).response.status).toBe(401);
  });

  it("rejects missing, inactive, and email-less employees without sending", async () => {
    for (const employee of [null, { active: false }, { email: null }, { email: "  " }]) {
      const { response, calls } = await run({ employee });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
    }
  });

  it("resends to an invited employee who has not signed in", async () => {
    const { response, body } = await run({
      employee: { user_id: "user-9", invite_code: null },
      authUser: { email: "server@example.com", last_sign_in_at: null, email_confirmed_at: null },
    });
    expect(response.status).toBe(200);
    expect(body.status).toBe("resent");
  });

  it("refuses to resend once the employee has signed in or the email changed", async () => {
    const signedIn = await run({
      employee: { user_id: "user-9", invite_code: null },
      authUser: { email: "server@example.com", last_sign_in_at: "2026-11-01T00:00:00Z" },
    });
    expect(signedIn.response.status).toBe(409);
    const changed = await run({
      employee: { user_id: "user-9", invite_code: null },
      authUser: { email: "old@example.com", last_sign_in_at: null },
    });
    expect(changed.response.status).toBe(409);
    expect(changed.calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
  });

  it("explains when the email already has a login", async () => {
    const { response, body } = await run({ inviteStatus: 422, inviteBody: { error_code: "email_exists" } });
    expect(response.status).toBe(409);
    expect(body.error).toBe("This email already has a Berrify login.");
  });

  it("refuses an email that already has an auth account without sending", async () => {
    const { response, calls } = await run({
      existingUsers: [{ email: "other-server@example.com" }, { email: "server@example.com" }],
    });
    expect(response.status).toBe(409);
    expect(calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
    const lookup = calls.find((c) => c.url.includes("/auth/v1/admin/users?"))!;
    expect(new URL(lookup.url).searchParams.get("filter")).toBe("server@example.com");
  });

  it("ignores partial email matches from the admin filter", async () => {
    const { response } = await run({ existingUsers: [{ email: "other-server@example.com" }] });
    expect(response.status).toBe(200);
  });

  it("pages past a full first page to find an exact match", async () => {
    const decoys = Array.from({ length: 100 }, (_, i) => ({ email: `server${i}@example.com.mx` }));
    const { response, calls } = await run({
      existingUsers: (page) => (page === 1 ? decoys : [{ email: "server@example.com" }]),
    });
    expect(response.status).toBe(409);
    expect(calls.filter((c) => c.url.includes("/auth/v1/admin/users?"))).toHaveLength(2);
    expect(calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
  });

  it("fails closed when the account lookup errors or never ends", async () => {
    const failed = await run({ existingUsers: () => new Response("boom", { status: 500 }) });
    expect(failed.response.status).toBe(502);
    expect(failed.calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
    const endless = Array.from({ length: 100 }, (_, i) => ({ email: `x${i}@example.com` }));
    const capped = await run({ existingUsers: () => endless });
    expect(capped.response.status).toBe(502);
    expect(capped.calls.some((c) => c.url.includes("/auth/v1/invite"))).toBe(false);
  });

  it("reports an invite that did not link to the roster row", async () => {
    const { response } = await run({ linkAfterInvite: false });
    expect(response.status).toBe(500);
  });

  it("only accepts POST", async () => {
    const fake = fakeSupabase({});
    const response = await handleEmployeeInvite(
      new Request(`https://berrify.app${PATH}`),
      env,
      PATH,
      fake.fetchImpl,
    );
    expect(response?.status).toBe(405);
  });
});
