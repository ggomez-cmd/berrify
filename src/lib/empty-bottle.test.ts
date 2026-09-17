import { describe, expect, it } from "vitest";
import {
  captionHasEmptyIntent,
  emptyBottleUsageMovement,
  emptyCallbackData,
  leftoverEmptyCaption,
  matchEmptyBottle,
  nextEmptyBottleStatus,
  parseEmptyBottleIdentify,
  parseEmptyCallbackData,
  skuFromEmptyLabel,
  textIsEmptyCommand,
  type EmptyBottleCatalogItem,
} from "./empty-bottle";
import { clearEmptyPhotoPending, consumeEmptyPhotoPending, markEmptyPhotoPending } from "./empty-bottle-pending";

const catalog: EmptyBottleCatalogItem[] = [
  { id: "i-rum", sku: "BV-EB-RUM", name: "Rum" },
  { id: "i-vodka", sku: "BV-EB-VODKA", name: "Vodka" },
  { id: "i-unknown", sku: "BV-EB-UNKNOWN", name: "Unknown liquor" },
];

describe("empty-bottle intent", () => {
  it("treats /empty and the word empty as intent, not emptying", () => {
    expect(captionHasEmptyIntent("/empty")).toBe(true);
    expect(captionHasEmptyIntent("Empty Semilla")).toBe(true);
    expect(captionHasEmptyIntent("factura empty")).toBe(true);
    expect(captionHasEmptyIntent("Semilla factura")).toBe(false);
    expect(captionHasEmptyIntent("emptying the bin")).toBe(false);
    expect(textIsEmptyCommand("/empty")).toBe(true);
    expect(textIsEmptyCommand("/empty@berrify_bot")).toBe(true);
    expect(textIsEmptyCommand("empty")).toBe(true);
    expect(textIsEmptyCommand("hello")).toBe(false);
  });

  it("parses confirm callback payloads", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseEmptyCallbackData(emptyCallbackData(true, id))).toEqual({
      confirm: true,
      eventId: id,
    });
    expect(parseEmptyCallbackData(`empty:no:${id}`)).toEqual({
      confirm: false,
      eventId: id,
    });
    expect(parseEmptyCallbackData("invoice:ok:1")).toBeNull();
  });
});

describe("empty-bottle matcher", () => {
  it("matches a catalog sku first", () => {
    expect(
      matchEmptyBottle({ sku: "bv-eb-rum", label: "something", confidence: 0.9 }, catalog),
    ).toEqual({ kind: "existing", item: catalog[0] });
  });

  it("fold-matches a free-text label", () => {
    expect(
      matchEmptyBottle({ sku: null, label: "dark rum bottle", confidence: 0.4 }, catalog),
    ).toEqual({ kind: "existing", item: catalog[0] });
  });

  it("creates a slug SKU or falls back to unknown", () => {
    expect(matchEmptyBottle({ sku: null, label: "Mezcal", confidence: 0.2 }, catalog)).toEqual({
      kind: "create",
      sku: skuFromEmptyLabel("Mezcal"),
      name: "Mezcal",
    });
    expect(matchEmptyBottle({ sku: null, label: "???", confidence: 0 }, catalog)).toEqual({
      kind: "unknown",
      item: catalog[2],
    });
  });
});

describe("empty-bottle debit", () => {
  it("confirms with a single usage -1 and is idempotent afterwards", () => {
    const first = nextEmptyBottleStatus("pending", "confirm");
    expect(first).toEqual({ next: "confirmed", applyDebit: true, changed: true });
    expect(nextEmptyBottleStatus("confirmed", "confirm")).toEqual({
      next: "confirmed",
      applyDebit: false,
      changed: false,
    });
    expect(emptyBottleUsageMovement({
      orgId: "org-1",
      itemId: "i-rum",
      label: "Rum",
      restaurantName: "Semilla",
    })).toEqual({
      org_id: "org-1",
      item_id: "i-rum",
      delta: -1,
      reason: "usage",
      note: "Telegram empty bottle · Rum · Semilla",
      created_by: null,
    });
  });

  it("cancels without a movement", () => {
    expect(nextEmptyBottleStatus("pending", "cancel")).toEqual({
      next: "cancelled",
      applyDebit: false,
      changed: true,
    });
    expect(nextEmptyBottleStatus("cancelled", "confirm")).toEqual({
      next: "cancelled",
      applyDebit: false,
      changed: false,
    });
  });
});

describe("empty-bottle helpers", () => {
  it("strips empty and restaurant words from the leftover caption", () => {
    expect(leftoverEmptyCaption("/empty Semilla rum", ["Semilla", "semilla"])).toBe("rum");
  });

  it("parses a Gemini identify payload", () => {
    expect(parseEmptyBottleIdentify({ sku: "BV-EB-GIN", label: "Gin", confidence: 0.8 })).toEqual({
      sku: "BV-EB-GIN",
      label: "Gin",
      confidence: 0.8,
    });
    expect(parseEmptyBottleIdentify({ label: "", confidence: 1 })).toBeNull();
  });

  it("remembers a pending /empty until the next photo", () => {
    clearEmptyPhotoPending();
    markEmptyPhotoPending("-100", "rum", 1_000);
    expect(consumeEmptyPhotoPending("-100", 2_000)).toEqual({ consumed: true, hint: "rum" });
    expect(consumeEmptyPhotoPending("-100", 3_000)).toEqual({ consumed: false, hint: "" });
    markEmptyPhotoPending("-100", "vodka", 1_000, 10);
    expect(consumeEmptyPhotoPending("-100", 1_020)).toEqual({ consumed: false, hint: "" });
    clearEmptyPhotoPending();
  });
});
