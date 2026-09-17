export const EMPTY_BOTTLE_PENDING_TTL_MS = 15 * 60 * 1000;

type PendingEmptyPhoto = {
  expiresAt: number;
  hint: string;
};

const pendingByChat = new Map<string, PendingEmptyPhoto>();

export function markEmptyPhotoPending(
  chatId: string,
  hint = "",
  now = Date.now(),
  ttlMs = EMPTY_BOTTLE_PENDING_TTL_MS,
): void {
  pendingByChat.set(chatId, { expiresAt: now + ttlMs, hint });
}

export function consumeEmptyPhotoPending(
  chatId: string,
  now = Date.now(),
): { consumed: boolean; hint: string } {
  const row = pendingByChat.get(chatId);
  if (!row) return { consumed: false, hint: "" };
  pendingByChat.delete(chatId);
  if (row.expiresAt < now) return { consumed: false, hint: "" };
  return { consumed: true, hint: row.hint };
}

export function clearEmptyPhotoPending(chatId?: string): void {
  if (chatId) pendingByChat.delete(chatId);
  else pendingByChat.clear();
}
