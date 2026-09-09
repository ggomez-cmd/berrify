const PIN_PATTERN = /^[0-9]{4,8}$/;

export const MIN_CLOCK_PIN_LENGTH = 4;
export const MAX_CLOCK_PIN_LENGTH = 8;

export function isValidClockPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function normalizeClockPin(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, MAX_CLOCK_PIN_LENGTH);
}

export function pinError(pin: string): string | null {
  if (pin.length === 0) return "Enter a PIN";
  if (!isValidClockPin(pin)) return "PIN must be 4 to 8 digits";
  return null;
}
