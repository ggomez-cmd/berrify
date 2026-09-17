import { deltaForReason } from "./inventory";
import { foldText } from "./restaurant-route";

export const EMPTY_BOTTLE_SKU_PREFIX = "BV-EB-";
export const EMPTY_BOTTLE_UNKNOWN_SKU = "BV-EB-UNKNOWN";
export const EMPTY_BOTTLE_CATEGORY = "Beverages";
export const EMPTY_BOTTLE_UNIT = "bottle";
export const EMPTY_BOTTLE_SEED_QUANTITY = 12;
export const EMPTY_BOTTLE_REORDER_LEVEL = 4;
export const EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE =
  "Empty-bottle identify is unavailable. Ask a manager to configure Gemini.";
export const EMPTY_BOTTLE_AWAIT_PHOTO = "Send a photo of the empty bottle.";

export const EMPTY_BOTTLE_GENERIC_ITEMS = [
  { sku: "BV-EB-RUM", name: "Rum" },
  { sku: "BV-EB-VODKA", name: "Vodka" },
  { sku: "BV-EB-GIN", name: "Gin" },
  { sku: "BV-EB-TEQUILA", name: "Tequila" },
  { sku: "BV-EB-WHISKY", name: "Whisky" },
  { sku: "BV-EB-BEER", name: "Beer" },
  { sku: "BV-EB-WINE", name: "Wine" },
  { sku: "BV-EB-UNKNOWN", name: "Unknown liquor" },
] as const;

export type EmptyBottleGenericItem = (typeof EMPTY_BOTTLE_GENERIC_ITEMS)[number];

export function missingEmptyBottleItems(existingSkus: Iterable<string | null | undefined>): EmptyBottleGenericItem[] {
  const have = new Set(
    [...existingSkus].filter((sku): sku is string => Boolean(sku)).map((sku) => sku.toUpperCase()),
  );
  return EMPTY_BOTTLE_GENERIC_ITEMS.filter((item) => !have.has(item.sku));
}

export function emptyBottleSeedInsert(orgId: string, item: EmptyBottleGenericItem) {
  return {
    org_id: orgId,
    name: item.name,
    sku: item.sku,
    category: EMPTY_BOTTLE_CATEGORY,
    unit: EMPTY_BOTTLE_UNIT,
    quantity: EMPTY_BOTTLE_SEED_QUANTITY,
    reorder_level: EMPTY_BOTTLE_REORDER_LEVEL,
    unit_cost: 0,
    supplier_id: null,
  };
}

export type EmptyBottleEventStatus = "pending" | "confirmed" | "cancelled";

export type EmptyBottleCatalogItem = {
  id: string;
  sku: string;
  name: string;
};

export type EmptyBottleProposal = {
  sku: string | null;
  label: string;
  confidence: number;
};

export type EmptyBottleMatch =
  | { kind: "existing"; item: EmptyBottleCatalogItem }
  | { kind: "create"; sku: string; name: string }
  | { kind: "unknown"; item: EmptyBottleCatalogItem };

export type EmptyBottleCallback = {
  confirm: boolean;
  eventId: string;
};

const EMPTY_WORD = /(?:^|[\s/])(?:\/empty(?:@\w+)?|\bempty\b)(?=$|[\s.,!?;:])/iu;
const EMPTY_COMMAND = /^(?:\/empty(?:@\w+)?(?:\s+.*)?|empty)$/iu;
const CALLBACK = /^empty:(ok|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function captionHasEmptyIntent(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return EMPTY_WORD.test(text.trim());
}

export function textIsEmptyCommand(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return EMPTY_COMMAND.test(text.trim());
}

export function leftoverEmptyCaption(caption: string | null | undefined, stripWords: string[]): string {
  let text = caption ?? "";
  text = text.replace(/\/empty(?:@\w+)?/gi, " ");
  text = text.replace(/\bempty\b/gi, " ");
  for (const word of stripWords) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function parseEmptyCallbackData(data: string | null | undefined): EmptyBottleCallback | null {
  if (!data) return null;
  const match = data.trim().match(CALLBACK);
  if (!match) return null;
  return {
    confirm: match[1].toLowerCase() === "ok",
    eventId: match[2].toLowerCase(),
  };
}

export function emptyCallbackData(confirm: boolean, eventId: string): string {
  return `empty:${confirm ? "ok" : "no"}:${eventId}`;
}

export function parseEmptyBottleIdentify(payload: unknown): EmptyBottleProposal | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!label) return null;
  const sku = typeof row.sku === "string" && row.sku.trim() ? row.sku.trim() : null;
  const confidence =
    typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0;
  return { sku, label, confidence };
}

export function skuFromEmptyLabel(label: string): string {
  const slug = foldText(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-/g, "")
    .toUpperCase();
  if (!slug) return EMPTY_BOTTLE_UNKNOWN_SKU;
  return `${EMPTY_BOTTLE_SKU_PREFIX}${slug}`.slice(0, 32);
}

export function matchEmptyBottle(
  proposal: EmptyBottleProposal,
  catalog: EmptyBottleCatalogItem[],
): EmptyBottleMatch {
  const unknown =
    catalog.find((item) => item.sku.toUpperCase() === EMPTY_BOTTLE_UNKNOWN_SKU) ?? null;
  const bySku = new Map(catalog.map((item) => [item.sku.toUpperCase(), item]));

  if (proposal.sku) {
    const hit = bySku.get(proposal.sku.toUpperCase());
    if (hit) return { kind: "existing", item: hit };
  }

  const foldedLabel = foldText(proposal.label);
  let best: EmptyBottleCatalogItem | null = null;
  for (const item of catalog) {
    const foldedName = foldText(item.name);
    if (!foldedName) continue;
    const matched =
      foldedLabel === foldedName ||
      foldedLabel.includes(foldedName) ||
      foldedName.includes(foldedLabel);
    if (!matched) continue;
    if (!best || item.name.length > best.name.length) best = item;
  }
  if (best) return { kind: "existing", item: best };

  const sku = skuFromEmptyLabel(proposal.label);
  const existingSku = bySku.get(sku);
  if (existingSku && existingSku.sku.toUpperCase() !== EMPTY_BOTTLE_UNKNOWN_SKU) {
    return { kind: "existing", item: existingSku };
  }
  if (sku === EMPTY_BOTTLE_UNKNOWN_SKU) {
    if (unknown) return { kind: "unknown", item: unknown };
    return { kind: "create", sku: EMPTY_BOTTLE_UNKNOWN_SKU, name: "Unknown liquor" };
  }
  return { kind: "create", sku, name: proposal.label.trim() };
}

export function nextEmptyBottleStatus(
  current: EmptyBottleEventStatus,
  action: "confirm" | "cancel",
): { next: EmptyBottleEventStatus; applyDebit: boolean; changed: boolean } {
  switch (current) {
    case "pending":
      if (action === "confirm") return { next: "confirmed", applyDebit: true, changed: true };
      return { next: "cancelled", applyDebit: false, changed: true };
    case "confirmed":
      return { next: "confirmed", applyDebit: false, changed: false };
    case "cancelled":
      return { next: "cancelled", applyDebit: false, changed: false };
    default: {
      const exhaustive: never = current;
      return exhaustive;
    }
  }
}

export function emptyBottleMovementNote(label: string, restaurantName: string | null): string {
  return `Telegram empty bottle · ${label} · ${restaurantName ?? "org"}`;
}

export function emptyBottleUsageMovement(input: {
  orgId: string;
  itemId: string;
  label: string;
  restaurantName: string | null;
}): {
  org_id: string;
  item_id: string;
  delta: number;
  reason: "usage";
  note: string;
  created_by: null;
} {
  return {
    org_id: input.orgId,
    item_id: input.itemId,
    delta: deltaForReason("usage", 1),
    reason: "usage",
    note: emptyBottleMovementNote(input.label, input.restaurantName),
    created_by: null,
  };
}

export function emptyConfirmPrompt(label: string, place: string): string {
  return `Empty bottle: *${escapeTelegramMarkdown(label)}* at *${escapeTelegramMarkdown(place)}*. Debit 1 bottle?`;
}

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/[_*[\]`]/g, "\\$&");
}
