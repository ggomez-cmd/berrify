export const QBWC_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const PBKDF2_ITERATIONS = 100_000;

export type QbwcConnectionRow = {
  id: string;
  org_id: string;
  restaurant_id: string | null;
  name: string;
  qb_username: string;
  password_hash: string;
  owner_id: string;
  file_id: string;
  company_file: string | null;
  qb_company_name: string | null;
  qb_product_name: string | null;
  qb_major_version: string | null;
  qb_minor_version: string | null;
  is_active: boolean;
  last_connected_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
};

export type QbwcSessionRow = {
  ticket: string;
  connection_id: string;
  org_id: string;
  expires_at: string;
  last_error: string | null;
};

export type QbwcRestEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export function supabaseHeaders(serviceRole: string): HeadersInit {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  };
}

export function restUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomQbUsername(): string {
  return `bfy_${randomToken(6)}`;
}

export function randomQbPassword(): string {
  return randomToken(24);
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  return bytesToBase64Url(new Uint8Array(buffer));
}

export async function hashQbPassword(password: string, saltB64?: string): Promise<string> {
  const salt = saltB64
    ? Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bufferToBase64Url(bits)}`;
}

export async function verifyQbPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const expected = await hashQbPassword(password, parts[3]);
  return expected === stored;
}

export function newSessionTicket(): string {
  return crypto.randomUUID();
}

export function sessionExpiryIso(now = Date.now()): string {
  return new Date(now + QBWC_SESSION_TTL_MS).toISOString();
}

export function sessionIsExpired(row: Pick<QbwcSessionRow, "expires_at">, now = Date.now()): boolean {
  const expires = Date.parse(row.expires_at);
  return !Number.isFinite(expires) || expires <= now;
}

export async function findConnectionByUsername(
  env: QbwcRestEnv,
  username: string,
  fetchImpl: typeof fetch,
): Promise<QbwcConnectionRow | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return null;
  const response = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_desktop_connections?qb_username=eq.${encodeURIComponent(username)}&is_active=eq.true&limit=1`,
    ),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as QbwcConnectionRow[];
  return rows[0] ?? null;
}

export async function insertSession(
  env: QbwcRestEnv,
  row: QbwcSessionRow,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return false;
  const response = await fetchImpl(restUrl(supabaseUrl, "quickbooks_desktop_sessions"), {
    method: "POST",
    headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return response.ok;
}

export async function loadSession(
  env: QbwcRestEnv,
  ticket: string,
  fetchImpl: typeof fetch,
): Promise<{ session: QbwcSessionRow; connection: QbwcConnectionRow } | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return null;
  const sessionRes = await fetchImpl(
    restUrl(supabaseUrl, `quickbooks_desktop_sessions?ticket=eq.${encodeURIComponent(ticket)}&limit=1`),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!sessionRes.ok) return null;
  const sessions = (await sessionRes.json()) as QbwcSessionRow[];
  const session = sessions[0];
  if (!session || sessionIsExpired(session)) return null;
  const connRes = await fetchImpl(
    restUrl(supabaseUrl, `quickbooks_desktop_connections?id=eq.${encodeURIComponent(session.connection_id)}&limit=1`),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!connRes.ok) return null;
  const connections = (await connRes.json()) as QbwcConnectionRow[];
  const connection = connections[0];
  if (!connection || !connection.is_active) return null;
  return { session, connection };
}

export async function revokeSessionsForConnection(
  env: QbwcRestEnv,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return;
  await fetchImpl(
    restUrl(supabaseUrl, `quickbooks_desktop_sessions?connection_id=eq.${encodeURIComponent(connectionId)}`),
    { method: "DELETE", headers: supabaseHeaders(serviceRole) },
  );
}

export async function deleteSession(env: QbwcRestEnv, ticket: string, fetchImpl: typeof fetch): Promise<void> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return;
  await fetchImpl(restUrl(supabaseUrl, `quickbooks_desktop_sessions?ticket=eq.${encodeURIComponent(ticket)}`), {
    method: "DELETE",
    headers: supabaseHeaders(serviceRole),
  });
}

export async function setSessionError(
  env: QbwcRestEnv,
  ticket: string,
  message: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return;
  await fetchImpl(restUrl(supabaseUrl, `quickbooks_desktop_sessions?ticket=eq.${encodeURIComponent(ticket)}`), {
    method: "PATCH",
    headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
    body: JSON.stringify({ last_error: message }),
  });
}

export async function patchConnection(
  env: QbwcRestEnv,
  connectionId: string,
  patch: Partial<QbwcConnectionRow>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return false;
  const response = await fetchImpl(
    restUrl(supabaseUrl, `quickbooks_desktop_connections?id=eq.${encodeURIComponent(connectionId)}`),
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
  return response.ok;
}
