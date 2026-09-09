const STORAGE_KEY = "berrify.login-failures";
const MAX_FAILURES = 5;
const LOCK_MS = 30_000;

type FailureState = {
  count: number;
  lockedUntil: number | null;
};

function readState(): FailureState {
  if (typeof sessionStorage === "undefined") {
    return { count: 0, lockedUntil: null };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, lockedUntil: null };
    const parsed = JSON.parse(raw) as FailureState;
    return {
      count: Number(parsed.count) || 0,
      lockedUntil: typeof parsed.lockedUntil === "number" ? parsed.lockedUntil : null,
    };
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function writeState(state: FailureState): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loginLockRemainingMs(now = Date.now()): number {
  const lockedUntil = readState().lockedUntil;
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil - now);
}

export function recordLoginFailure(now = Date.now()): number {
  const current = readState();
  if (current.lockedUntil && current.lockedUntil > now) {
    return current.lockedUntil - now;
  }
  const count = current.count + 1;
  const lockedUntil = count >= MAX_FAILURES ? now + LOCK_MS : null;
  writeState({ count: lockedUntil ? 0 : count, lockedUntil });
  return lockedUntil ? LOCK_MS : 0;
}

export function clearLoginFailures(): void {
  writeState({ count: 0, lockedUntil: null });
}

export function isHoneypotFilled(value: string): boolean {
  return value.trim().length > 0;
}
