/** Wrap PostgREST `{ message }` objects so `instanceof Error` and `.message` work. */
export function toThrownError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string" && err.trim()) return new Error(err);
  if (typeof err === "object" && err !== null) {
    const row = err as { message?: unknown; details?: unknown };
    const message = typeof row.message === "string" ? row.message.trim() : "";
    const details = typeof row.details === "string" ? row.details.trim() : "";
    if (details && (!message || message === fallback || /^P0001\b/.test(message))) {
      return new Error(details);
    }
    if (message) return new Error(message);
    if (details) return new Error(details);
  }
  return new Error(fallback);
}
