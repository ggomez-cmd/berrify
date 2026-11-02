import { formatMoney } from "../../lib/format";

export function formatCents(cents: number): string {
  return formatMoney(cents / 100);
}

export function formatHoursHundredths(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

export function parseSignedCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/\$/g, "").replace(/,/g, "");
  if (!trimmed) return 0;
  const match = trimmed.match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match || !match[2]) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

const SCOPED_POSITION = /(\w+)::([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const BARE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Issues come from the engine and run builder with raw ids, and are stored that way.
// Swap in names only for display; unknown ids stay as-is so nothing is hidden.
export function readableIssue(
  text: string,
  employeeNames: Record<string, string>,
  restaurantNames: Record<string, string>,
): string {
  return text
    .replace(SCOPED_POSITION, (match, position: string, restaurantId: string) => {
      const restaurant = restaurantNames[restaurantId.toLowerCase()];
      return restaurant ? `${position} at ${restaurant}` : match;
    })
    .replace(BARE_ID, (id) => employeeNames[id.toLowerCase()] ?? restaurantNames[id.toLowerCase()] ?? id);
}
