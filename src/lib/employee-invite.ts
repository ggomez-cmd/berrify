import type { Employee } from "./types";
import { supabase } from "./supabase";

export type EmployeeLogin = {
  employee_id: string;
  invited_at: string | null;
  last_sign_in_at: string | null;
};

export type LoginState = "linked" | "invited" | "not-invited" | "no-email" | "inactive";

export function loginState(employee: Employee, login: EmployeeLogin | undefined): LoginState {
  if (employee.user_id) {
    return login && !login.last_sign_in_at ? "invited" : "linked";
  }
  if (!employee.email?.trim()) return "no-email";
  if (!employee.active) return "inactive";
  return "not-invited";
}

export function canSendInvite(employee: Employee, state: LoginState): boolean {
  return employee.active && Boolean(employee.email?.trim()) && (state === "not-invited" || state === "invited");
}

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function sendEmployeeInvite(
  employeeId: string,
  fetchImpl: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = defaultAccessToken,
): Promise<"sent" | "resent"> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`/api/employees/${encodeURIComponent(employeeId)}/invite`, {
    method: "POST",
    headers,
    credentials: "same-origin",
  });
  let payload: { error?: unknown; status?: unknown } | null = null;
  try {
    payload = (await response.json()) as { error?: unknown; status?: unknown };
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload?.error === "string" && payload.error.trim() ? payload.error : null;
    throw new Error(message ?? `Could not send the invite (${response.status})`);
  }
  return payload?.status === "resent" ? "resent" : "sent";
}
