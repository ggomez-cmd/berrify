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
