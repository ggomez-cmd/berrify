import { describe, expect, it } from "vitest";
import { pickTelegramAttachCandidate } from "./telegram-page-attach";

const existing = {
  id: "inv-1",
  vendor_name: "Jose Santiago Inc (food)",
  invoice_number: "6512495",
  created_at: "2026-09-20T18:00:00.000Z",
  telegram_message_id: "-100:10",
  telegram_media_group_id: "album-1",
};

describe("Telegram page attach", () => {
  it("attaches the same album to one invoice", () => {
    const hit = pickTelegramAttachCandidate({
      mediaGroupId: "album-1",
      caption: null,
      chatId: "-100",
      invoices: [existing],
      nowMs: Date.parse("2026-09-20T18:05:00.000Z"),
    });
    expect(hit?.id).toBe("inv-1");
  });

  it("attaches a page 2 caption in the same chat window", () => {
    const hit = pickTelegramAttachCandidate({
      mediaGroupId: null,
      caption: "page 2",
      chatId: "-100",
      invoices: [{ ...existing, telegram_media_group_id: null }],
      nowMs: Date.parse("2026-09-20T18:10:00.000Z"),
    });
    expect(hit?.id).toBe("inv-1");
  });

  it("does not attach a different vendor letterhead", () => {
    const hit = pickTelegramAttachCandidate({
      mediaGroupId: "album-1",
      caption: "SuperMax",
      chatId: "-100",
      invoices: [existing],
      incomingVendorFullName: "SuperMax",
      nowMs: Date.parse("2026-09-20T18:05:00.000Z"),
    });
    expect(hit).toBeNull();
  });
});
