import { describe, expect, it } from "vitest";
import { buildTelegramInvoiceInsert } from "./telegram-invoice";
import type { Restaurant, RestaurantAlias } from "./restaurant-route";

const semilla: Restaurant = {
  id: "r-semilla",
  name: "Semilla",
  qbo_company_name: "Semilla",
  slug: "semilla",
};

const aliases: RestaurantAlias[] = [
  { restaurant_id: semilla.id, match_kind: "caption", match_text: "semilla" },
];

describe("buildTelegramInvoiceInsert", () => {
  it("stores the photo as received Telegram without OCR", () => {
    const row = buildTelegramInvoiceInsert({
      orgId: "org-1",
      from: "@cook",
      caption: "Semilla factura",
      messageId: "-100:42",
      imageData: "data:image/jpeg;base64,abc",
      imageMime: "image/jpeg",
      restaurants: [semilla],
      aliases,
    });
    expect(row).toMatchObject({
      org_id: "org-1",
      restaurant_id: semilla.id,
      status: "received",
      source: "telegram",
      telegram_from: "@cook",
      telegram_message_id: "-100:42",
      caption: "Semilla factura",
      ocr_text: null,
    });
  });

  it("leaves restaurant unset when the caption does not match", () => {
    const row = buildTelegramInvoiceInsert({
      orgId: "org-1",
      from: "@cook",
      caption: "unknown kitchen",
      messageId: "-100:43",
      imageData: "data:image/jpeg;base64,abc",
      imageMime: "image/jpeg",
      restaurants: [semilla],
      aliases,
    });
    expect(row.restaurant_id).toBeNull();
  });
});
