export function assertTelegramMethodOk(method: string, status: number, rawBody: string): void {
  let payload: unknown = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error(`Telegram ${method} failed (${status}): invalid JSON`);
    }
  }
  const ok =
    status >= 200 &&
    status < 300 &&
    payload !== null &&
    typeof payload === "object" &&
    (payload as { ok?: unknown }).ok === true;
  if (ok) return;

  const description =
    payload && typeof payload === "object" && typeof (payload as { description?: unknown }).description === "string"
      ? (payload as { description: string }).description.trim()
      : rawBody.trim() || "request failed";
  throw new Error(`Telegram ${method} failed (${status}): ${description}`);
}
