import { describe, expect, it } from "vitest";
import {
  captionHasEmptyIntent,
  debitLinesForEmptyBottle,
  emptyBottleCountsMismatch,
  emptyBottleSourceLabel,
  emptyBottleSummaryLabel,
  emptyBottleUsageMovement,
  emptyBottleUsageMovementsForLines,
  emptyCallbackData,
  emptyConfirmLinesPrompt,
  filterEmptyBottleEvents,
  leftoverEmptyCaption,
  matchEmptyBottle,
  nextEmptyBottleStatus,
  parseEmptyBottleIdentify,
  parseEmptyBottleIdentifyLines,
  parseEmptyCallbackData,
  shouldRetryEmptyBottleGemini,
  skuFromEmptyLabel,
  textIsEmptyCommand,
  type EmptyBottleCatalogItem,
} from "./empty-bottle";

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
    expect(textIsEmptyCommand("/empty@berrify.bot")).toBe(true);
    expect(textIsEmptyCommand("/empty@foo-bot")).toBe(true);
    expect(textIsEmptyCommand("\u200B/empty")).toBe(true);
    expect(textIsEmptyCommand("/empty\u200B")).toBe(true);
    expect(textIsEmptyCommand("/\u200Bempty")).toBe(true);
    expect(textIsEmptyCommand("\uFF0Fempty")).toBe(true);
    expect(textIsEmptyCommand("/empty\u00A0please")).toBe(true);
    expect(textIsEmptyCommand("empty")).toBe(true);
    expect(textIsEmptyCommand("hello")).toBe(false);
    expect(textIsEmptyCommand("/emptying")).toBe(false);
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

  it("debits one usage movement per line qty and is a no-op after confirm or cancel", () => {
    const lines = Array.from({ length: 11 }, (_, index) => ({
      proposed_item_id: `i-${index}`,
      proposed_label: `Bottle ${index + 1}`,
      qty: 1,
    }));
    const movements = emptyBottleUsageMovementsForLines({
      orgId: "org-1",
      restaurantName: "Semilla",
      lines,
    });
    expect(movements).toHaveLength(11);
    expect(movements.every((row) => row.delta === -1 && row.reason === "usage")).toBe(true);
    expect(
      emptyBottleUsageMovementsForLines({
        orgId: "org-1",
        restaurantName: "Semilla",
        lines: [{ proposed_item_id: "i-wine", proposed_label: "Wine", qty: 2 }],
      }),
    ).toEqual([
      emptyBottleUsageMovement({
        orgId: "org-1",
        itemId: "i-wine",
        label: "Wine",
        restaurantName: "Semilla",
        qty: 2,
      }),
    ]);
    expect(nextEmptyBottleStatus("confirmed", "confirm").applyDebit).toBe(false);
    expect(nextEmptyBottleStatus("cancelled", "confirm").applyDebit).toBe(false);
    expect(
      debitLinesForEmptyBottle({
        proposed_item_id: "i-rum",
        proposed_label: "Rum",
        lines: [],
      }),
    ).toEqual([{ proposed_item_id: "i-rum", proposed_label: "Rum", qty: 1 }]);
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
    expect(leftoverEmptyCaption("/empty@berrify.bot rum", [])).toBe("rum");
  });

  it("parses a Gemini identify payload", () => {
    expect(parseEmptyBottleIdentify({ sku: "BV-EB-GIN", label: "Gin", confidence: 0.8 })).toEqual({
      sku: "BV-EB-GIN",
      label: "Gin",
      confidence: 0.8,
    });
    expect(parseEmptyBottleIdentify({ label: "", confidence: 1 })).toBeNull();
  });

  it("rejects the single-bottle Gemini schema and accepts 11 lines", () => {
    expect(parseEmptyBottleIdentifyLines({ sku: "BV-EB-RUM", label: "Rum", confidence: 0.9 })).toBeNull();
    const labels = [
      "Red wine",
      "White wine",
      "Averna",
      "Bravada",
      "Grey Goose",
      "Hendrick's",
      "Macallan 12",
      "Woodford Reserve",
      "Wine 3",
      "Wine 4",
      "Unknown",
    ];
    const parsed = parseEmptyBottleIdentifyLines({
      bottle_count: 11,
      lines: labels.map((label, index) => ({ index: index + 1, label, sku: null, qty: 1 })),
    });
    expect(parsed?.lines).toHaveLength(11);
    expect(parsed?.bottle_count).toBe(11);
  });

  it("retries Gemini when counts differ", () => {
    expect(
      shouldRetryEmptyBottleGemini({ bottle_count: 2, lines: [{ index: 1, label: "Rum", sku: null, qty: 1 }] }, null),
    ).toBe(true);
    expect(
      shouldRetryEmptyBottleGemini(
        {
          bottle_count: 3,
          lines: [
            { index: 1, label: "A", sku: null, qty: 1 },
            { index: 2, label: "B", sku: null, qty: 1 },
            { index: 3, label: "C", sku: null, qty: 1 },
          ],
        },
        11,
      ),
    ).toBe(true);
    expect(
      shouldRetryEmptyBottleGemini(
        {
          bottle_count: 1,
          lines: [{ index: 1, label: "Rum", sku: null, qty: 1 }],
        },
        1,
      ),
    ).toBe(false);
  });

  it("filters list rows and flags a Vision/Gemini mismatch", () => {
    const rows = [
      { id: "1", restaurant_id: "r-1", status: "pending" as const },
      { id: "2", restaurant_id: "r-2", status: "confirmed" as const },
    ];
    expect(filterEmptyBottleEvents(rows, "r-1", "all")).toEqual([rows[0]]);
    expect(filterEmptyBottleEvents(rows, "", "confirmed")).toEqual([rows[1]]);
    expect(emptyBottleCountsMismatch(11, 9)).toBe(true);
    expect(emptyBottleCountsMismatch(11, 11)).toBe(false);
    expect(emptyBottleCountsMismatch(null, 11)).toBe(false);
    expect(emptyBottleSourceLabel("app")).toBe("App");
    expect(emptyBottleSummaryLabel(11)).toBe("11 bottles");
    expect(emptyConfirmLinesPrompt({
      place: "Semilla",
      lines: [{ proposed_label: "Rum", qty: 1 }],
      visionCount: 11,
      geminiCount: 9,
    })).toContain("Vision 11 / Gemini 9");
  });
});
