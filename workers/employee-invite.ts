import { restUrl, supabaseHeaders } from "./qbwc-auth";
import { requireManager, type QbwcManagerEnv } from "./qbwc-manager";

export type InviteStatus = "sent" | "resent";

type EmployeeRow = {
  id: string;
  email: string | null;
  user_id: string | null;
  active: boolean;
  invite_code: string | null;
};

type AuthUser = {
  email?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
};

const USER_PAGE_SIZE = 100;
const MAX_USER_PAGES = 20;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function parseInvitePath(pathname: string): string | null {
  return /^\/api\/employees\/([0-9a-f-]{36})\/invite$/i.exec(pathname)?.[1] ?? null;
}

export function acceptInviteUrl(request: Request): string {
  return `${new URL(request.url).origin}/accept-invite`;
}

async function readAuthError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error_code?: string; code?: string; msg?: string; message?: string };
    return body.error_code ?? body.code ?? body.msg ?? body.message ?? "";
  } catch {
    return "";
  }
}

async function authUserExists(
  supabaseUrl: string,
  headers: HeadersInit,
  email: string,
  fetchImpl: typeof fetch,
): Promise<boolean | null> {
  // GoTrue's filter is a substring match on email and name, so page through
  // every candidate and compare exactly. Fail closed if the scan cannot finish.
  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const url = new URL(`${supabaseUrl}/auth/v1/admin/users`);
    url.searchParams.set("filter", email);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(USER_PAGE_SIZE));
    const res = await fetchImpl(url.toString(), { headers });
    if (!res.ok) return null;
    const users = ((await res.json()) as { users?: AuthUser[] }).users ?? [];
    if (users.some((user) => user.email?.toLowerCase() === email)) return true;
    if (users.length < USER_PAGE_SIZE) return false;
  }
  return null;
}

export async function handleEmployeeInvite(
  request: Request,
  env: QbwcManagerEnv,
  pathname: string,
  fetchImpl: typeof fetch,
): Promise<Response | null> {
  const employeeId = parseInvitePath(pathname);
  if (!employeeId) return null;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const caller = await requireManager(request, env, fetchImpl);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return json({ error: "Only admins can send invites." }, 403);

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { ...supabaseHeaders(serviceRole), Accept: "application/json" };

  const employeeRes = await fetchImpl(
    restUrl(
      supabaseUrl,
      `employees?id=eq.${employeeId}&org_id=eq.${encodeURIComponent(caller.orgId)}` +
        "&select=id,email,user_id,active,invite_code&limit=1",
    ),
    { headers },
  );
  if (!employeeRes.ok) return json({ error: "Could not load employee." }, 502);
  const employee = ((await employeeRes.json()) as EmployeeRow[])[0];
  if (!employee) return json({ error: "Employee not found." }, 404);
  if (!employee.active) return json({ error: "This employee is inactive." }, 400);
  const email = employee.email?.trim().toLowerCase();
  if (!email) return json({ error: "Add an email before sending an invite." }, 400);

  let status: InviteStatus = "sent";
  if (employee.user_id) {
    const userRes = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${employee.user_id}`, { headers });
    if (!userRes.ok) return json({ error: "Could not load this login." }, 502);
    const user = (await userRes.json()) as AuthUser;
    if (user.last_sign_in_at || user.email_confirmed_at) {
      return json({ error: "This employee already has a login." }, 409);
    }
    if (user.email?.toLowerCase() !== email) {
      return json({ error: "The email changed after the invite was sent." }, 409);
    }
    status = "resent";
  } else if (!employee.invite_code) {
    return json({ error: "This employee has no invite code. Save their email again." }, 409);
  } else {
    const existing = await authUserExists(supabaseUrl, headers, email, fetchImpl);
    if (existing === null) return json({ error: "Could not check this email." }, 502);
    if (existing) {
      return json(
        { error: "This email already has a Berrify login from an earlier signup. Remove it in Supabase or use another email." },
        409,
      );
    }
  }

  const inviteUrl = new URL(`${supabaseUrl}/auth/v1/invite`);
  inviteUrl.searchParams.set("redirect_to", acceptInviteUrl(request));
  const inviteRes = await fetchImpl(inviteUrl.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      data: employee.invite_code ? { invite_code: employee.invite_code } : {},
    }),
  });
  if (!inviteRes.ok) {
    const code = await readAuthError(inviteRes);
    if (code === "email_exists" || code === "user_already_exists") {
      return json({ error: "This email already has a Berrify login." }, 409);
    }
    if (inviteRes.status === 422 || inviteRes.status === 400) {
      return json({ error: "Supabase rejected this email address." }, 400);
    }
    if (inviteRes.status === 429 || code === "over_email_send_rate_limit") {
      return json({ error: "Too many emails sent. Try again later." }, 429);
    }
    return json({ error: "Could not send the invite." }, 502);
  }

  if (status === "sent") {
    const linkedRes = await fetchImpl(
      restUrl(supabaseUrl, `employees?id=eq.${employeeId}&select=user_id&limit=1`),
      { headers },
    );
    const linked = linkedRes.ok ? ((await linkedRes.json()) as Array<{ user_id: string | null }>)[0] : undefined;
    if (!linked?.user_id) {
      return json({ error: "The invite was sent but did not link to this employee." }, 500);
    }
  }

  return json({ ok: true, status });
}
