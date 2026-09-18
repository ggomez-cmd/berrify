export const EMPTY_BOTTLE_PENDING_TTL_MS = 15 * 60 * 1000;

export type EmptyBottlePendingResult = {
  consumed: boolean;
  hint: string;
};

type PendingRow = {
  org_id: string;
  chat_id: string;
  hint: string;
  expires_at: string;
};

function supabaseHeaders(serviceRole: string): HeadersInit {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  };
}

function restUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
}

export function emptyBottlePendingSelectPath(orgId: string, chatId: string): string {
  return `empty_bottle_pending?org_id=eq.${encodeURIComponent(orgId)}&chat_id=eq.${encodeURIComponent(chatId)}`;
}

export function emptyBottlePendingUpsertBody(
  orgId: string,
  chatId: string,
  hint: string,
  now: number,
  ttlMs: number,
): PendingRow {
  return {
    org_id: orgId,
    chat_id: chatId,
    hint,
    expires_at: new Date(now + ttlMs).toISOString(),
  };
}

function readHint(row: PendingRow | undefined, now: number): EmptyBottlePendingResult {
  if (!row) return { consumed: false, hint: "" };
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return { consumed: false, hint: "" };
  return { consumed: true, hint: row.hint };
}

export async function markEmptyPhotoPending(input: {
  supabaseUrl: string;
  serviceRole: string;
  orgId: string;
  chatId: string;
  hint?: string;
  now?: number;
  ttlMs?: number;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const body = emptyBottlePendingUpsertBody(
    input.orgId,
    input.chatId,
    input.hint ?? "",
    input.now ?? Date.now(),
    input.ttlMs ?? EMPTY_BOTTLE_PENDING_TTL_MS,
  );
  const response = await input.fetchImpl(
    restUrl(input.supabaseUrl, "empty_bottle_pending?on_conflict=org_id,chat_id"),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(input.serviceRole),
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`empty_bottle_pending upsert failed (${response.status})`);
  }
}

export async function consumeEmptyPhotoPending(input: {
  supabaseUrl: string;
  serviceRole: string;
  orgId: string;
  chatId: string;
  now?: number;
  fetchImpl: typeof fetch;
}): Promise<EmptyBottlePendingResult> {
  const response = await input.fetchImpl(
    restUrl(input.supabaseUrl, emptyBottlePendingSelectPath(input.orgId, input.chatId)),
    {
      method: "DELETE",
      headers: {
        ...supabaseHeaders(input.serviceRole),
        Prefer: "return=representation",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`empty_bottle_pending consume failed (${response.status})`);
  }
  const rows = (await response.json()) as PendingRow[];
  return readHint(rows[0], input.now ?? Date.now());
}
