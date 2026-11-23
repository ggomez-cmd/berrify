import type { MembershipRole } from "./types";

export const KIOSK_IDLE_MS = 20_000;
export const KIOSK_CONFIRM_MS = 1600;

export function shouldPromptKioskExit(required: boolean | undefined): boolean {
  return required !== false;
}

export const KIOSK_PATH = "/kiosk";

export function isKioskLogin(role: MembershipRole | null): boolean {
  return role === "kiosk";
}

// Only the tablet's kiosk login. Admin and manager logins cannot open it.
export function canOpenKiosk(role: MembershipRole | null): boolean {
  return isKioskLogin(role);
}

export function kioskLockRedirect(role: MembershipRole | null, pathname: string): string | null {
  if (!isKioskLogin(role)) return null;
  return pathname === KIOSK_PATH ? null : KIOSK_PATH;
}
