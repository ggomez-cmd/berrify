import { describe, expect, it } from "vitest";
import { buildWhatsAppInvoiceInsert } from "./whatsapp-invoice";
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

describe("buildWhatsAppInvoiceInsert", () => {
  it("stores the photo as received WhatsApp without OCR", () => {
    const row = buildWhatsAppInvoiceInsert({
      orgId: "org-1",
      from: "17875550100",
      caption: "Semilla factura",
      messageId: "wamid.HBgLTEST",
      imageData: "data:image/jpeg;base64,abc",
      imageMime: "image/jpeg",
      restaurants: [semilla],
      aliases,
    });
    expect(row).toMatchObject({
      org_id: "org-1",
      restaurant_id: semilla.id,
      status: "received",
      source: "whatsapp",
      whatsapp_from: "17875550100",
      whatsapp_message_id: "wamid.HBgLTEST",
      caption: "Semilla factura",
      ocr_text: null,
    });
  });

  it("leaves restaurant unset when the caption does not match", () => {
    const row = buildWhatsAppInvoiceInsert({
      orgId: "org-1",
      from: "17875550100",
      caption: "unknown kitchen",
      messageId: "wamid.OTHER",
      imageData: "data:image/jpeg;base64,abc",
      imageMime: "image/jpeg",
      restaurants: [semilla],
      aliases,
    });
    expect(row.restaurant_id).toBeNull();
  });
});
