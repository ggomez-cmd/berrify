export const KIOSK_IDLE_MS = 20_000;
export const KIOSK_CONFIRM_MS = 1600;

export function shouldPromptKioskExit(required: boolean | undefined): boolean {
  return required !== false;
}
