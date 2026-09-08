const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const qty = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return currency.format(Number(value) || 0);
}

export function formatQty(value: number): string {
  return qty.format(Number(value) || 0);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const delta = Date.now() - then;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
