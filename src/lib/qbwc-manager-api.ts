import { supabase } from "./supabase";
import type { QuickbooksDesktopConnection } from "./types";

export type CreateQbwcConnectionInput = {
  restaurant_id?: string | null;
  name?: string;
  company_file?: string | null;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
};

export type CreateQbwcConnectionResult = {
  connection: QuickbooksDesktopConnection;
  password: string;
};

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function readError(payload: unknown, status: number, fallback: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `${fallback} (${status})`;
}

export async function createQbwcConnection(
  input: CreateQbwcConnectionInput,
): Promise<CreateQbwcConnectionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = await authHeaders(input.getAccessToken ?? defaultAccessToken);
  const response = await fetchImpl("/api/qbwc/connections", {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({
      restaurant_id: input.restaurant_id ?? null,
      name: input.name,
      company_file: input.company_file ?? null,
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(readError(payload, response.status, "Could not create connection"));
  }
  const row = payload as CreateQbwcConnectionResult;
  if (!row?.connection?.id || typeof row.password !== "string") {
    throw new Error("Could not create connection");
  }
  return row;
}

export async function rotateQbwcPassword(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = defaultAccessToken,
): Promise<string> {
  const headers = await authHeaders(getAccessToken);
  const response = await fetchImpl(`/api/qbwc/connections/${encodeURIComponent(connectionId)}/rotate`, {
    method: "POST",
    headers,
    credentials: "same-origin",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(readError(payload, response.status, "Could not regenerate password"));
  }
  const password = (payload as { password?: unknown }).password;
  if (typeof password !== "string" || !password) {
    throw new Error("Could not regenerate password");
  }
  return password;
}

export async function revokeQbwcConnection(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = defaultAccessToken,
): Promise<void> {
  const headers = await authHeaders(getAccessToken);
  const response = await fetchImpl(`/api/qbwc/connections/${encodeURIComponent(connectionId)}/revoke`, {
    method: "POST",
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(readError(payload, response.status, "Could not revoke connection"));
  }
}

export async function downloadBerrifyQwc(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = defaultAccessToken,
): Promise<void> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`/api/qbwc/connections/${encodeURIComponent(connectionId)}/qwc`, {
    method: "GET",
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not download Berrify.qwc");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Berrify.qwc";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
