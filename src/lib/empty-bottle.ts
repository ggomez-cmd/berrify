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

export type EmptyBottleIdentifyLine = {
  index: number;
  label: string;
  sku: string | null;
  qty: number;
};

export type EmptyBottleIdentifyResult = {
  bottle_count: number;
  lines: EmptyBottleIdentifyLine[];
};

export type EmptyBottleDebitLine = {
  proposed_item_id: string;
  proposed_label: string;
  qty: number;
};

export type EmptyBottleSource = "telegram" | "app";

export type EmptyBottleMatch =
  | { kind: "existing"; item: EmptyBottleCatalogItem }
  | { kind: "create"; sku: string; name: string }
  | { kind: "unknown"; item: EmptyBottleCatalogItem };

export type EmptyBottleCallback = {
  confirm: boolean;
  eventId: string;
};

const EMPTY_BOT_MENTION = String.raw`(?:@[^\s/@]+)`;
const EMPTY_WORD = new RegExp(
  String.raw`(?:^|[\s/])(?:\/empty${EMPTY_BOT_MENTION}?|\bempty\b)(?=$|[\s.,!?;:])`,
  "iu",
);
const EMPTY_COMMAND = new RegExp(String.raw`^(?:\/empty${EMPTY_BOT_MENTION}?(?:\s+.*)?|empty)$`, "iu");
const EMPTY_COMMAND_TOKEN = new RegExp(String.raw`\/empty${EMPTY_BOT_MENTION}?`, "gi");
const CALLBACK = /^empty:(ok|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function normalizeTelegramCommandText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\uFF0F/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export function captionHasEmptyIntent(text: string | null | undefined): boolean {
  const normalized = normalizeTelegramCommandText(text);
  if (!normalized) return false;
  return EMPTY_WORD.test(normalized);
}

export function textIsEmptyCommand(text: string | null | undefined): boolean {
  const normalized = normalizeTelegramCommandText(text);
  if (!normalized) return false;
  return EMPTY_COMMAND.test(normalized);
}

export function leftoverEmptyCaption(caption: string | null | undefined, stripWords: string[]): string {
  let text = normalizeTelegramCommandText(caption);
  text = text.replace(EMPTY_COMMAND_TOKEN, " ");
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

function asPositiveQty(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

export function parseEmptyBottleIdentifyLines(payload: unknown): EmptyBottleIdentifyResult | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (!Array.isArray(row.lines)) return null;
  const lines: EmptyBottleIdentifyLine[] = [];
  for (const [offset, raw] of row.lines.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    const index =
      typeof item.index === "number" && Number.isFinite(item.index) ? item.index : offset + 1;
    const sku = typeof item.sku === "string" && item.sku.trim() ? item.sku.trim() : null;
    lines.push({ index, label, sku, qty: asPositiveQty(item.qty) });
  }
  if (lines.length === 0) return null;
  const bottleCount =
    typeof row.bottle_count === "number" && Number.isFinite(row.bottle_count) && row.bottle_count >= 1
      ? Math.floor(row.bottle_count)
      : lines.length;
  return { bottle_count: bottleCount, lines };
}

export function isFarFromVisionCount(lineCount: number, visionCount: number): boolean {
  const delta = Math.abs(lineCount - visionCount);
  return delta >= 2 && delta / visionCount >= 0.2;
}

export function shouldRetryEmptyBottleGemini(
  result: EmptyBottleIdentifyResult,
  visionCount: number | null,
): boolean {
  if (result.lines.length !== result.bottle_count) return true;
  if (visionCount != null && visionCount >= 2) {
    return isFarFromVisionCount(result.lines.length, visionCount);
  }
  return false;
}

export function emptyBottleSummaryLabel(count: number): string {
  return `${count} bottle${count === 1 ? "" : "s"}`;
}

export function emptyBottleCountsMismatch(
  visionCount: number | null | undefined,
  geminiCount: number | null | undefined,
): boolean {
  if (visionCount == null || geminiCount == null) return false;
  return visionCount !== geminiCount;
}

export function filterEmptyBottleEvents<
  T extends { restaurant_id: string | null; status: EmptyBottleEventStatus },
>(events: T[], restaurantId: string, status: "all" | EmptyBottleEventStatus): T[] {
  return events.filter((event) => {
    if (restaurantId && event.restaurant_id !== restaurantId) return false;
    if (status !== "all" && event.status !== status) return false;
    return true;
  });
}

export function legacyEmptyBottleLines(event: {
  proposed_item_id: string | null;
  proposed_label: string;
}): EmptyBottleDebitLine[] {
  if (!event.proposed_item_id) return [];
  return [
    {
      proposed_item_id: event.proposed_item_id,
      proposed_label: event.proposed_label,
      qty: 1,
    },
  ];
}

export function debitLinesForEmptyBottle(input: {
  proposed_item_id: string | null;
  proposed_label: string;
  lines: Array<{ proposed_item_id: string | null; proposed_label: string; qty: number }>;
}): EmptyBottleDebitLine[] {
  const fromLines = input.lines
    .filter((line): line is EmptyBottleDebitLine => Boolean(line.proposed_item_id) && line.qty >= 1)
    .map((line) => ({
      proposed_item_id: line.proposed_item_id,
      proposed_label: line.proposed_label,
      qty: line.qty,
    }));
  if (fromLines.length > 0) return fromLines;
  return legacyEmptyBottleLines(input);
}

export function emptyBottleSourceLabel(source: EmptyBottleSource): string {
  switch (source) {
    case "telegram":
      return "Telegram";
    case "app":
      return "App";
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
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
  qty?: number;
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
    delta: deltaForReason("usage", input.qty ?? 1),
    reason: "usage",
    note: emptyBottleMovementNote(input.label, input.restaurantName),
    created_by: null,
  };
}

export function emptyBottleUsageMovementsForLines(input: {
  orgId: string;
  restaurantName: string | null;
  lines: EmptyBottleDebitLine[];
}): ReturnType<typeof emptyBottleUsageMovement>[] {
  return input.lines.map((line) =>
    emptyBottleUsageMovement({
      orgId: input.orgId,
      itemId: line.proposed_item_id,
      label: line.proposed_label,
      restaurantName: input.restaurantName,
      qty: line.qty,
    }),
  );
}

export function emptyConfirmPrompt(label: string, place: string): string {
  return `Empty bottle: *${escapeTelegramMarkdown(label)}* at *${escapeTelegramMarkdown(place)}*. Debit 1 bottle?`;
}

export function emptyConfirmLinesPrompt(input: {
  place: string;
  lines: Array<{ proposed_label: string; qty: number }>;
  visionCount: number | null;
  geminiCount: number | null;
}): string {
  const listed = input.lines
    .map((line, index) => `${index + 1}. ${escapeTelegramMarkdown(line.proposed_label)} ×${line.qty}`)
    .join("\n");
  const vision = input.visionCount == null ? "—" : String(input.visionCount);
  const gemini = input.geminiCount == null ? "—" : String(input.geminiCount);
  const header = `Empty bottles at *${escapeTelegramMarkdown(input.place)}*. Vision ${vision} / Gemini ${gemini}`;
  return `${header}\n${listed || "No lines"}\nDebit these bottles?`;
}

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/[_*[\]`]/g, "\\$&");
}
