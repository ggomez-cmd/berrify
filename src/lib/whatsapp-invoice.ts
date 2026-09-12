import { matchRestaurant, type Restaurant, type RestaurantAlias } from "./restaurant-route";

export type WhatsAppInvoiceInsert = {
  org_id: string;
  restaurant_id: string | null;
  status: "received";
  source: "whatsapp";
  terms: "Net 15";
  whatsapp_from: string;
  whatsapp_group: string | null;
  whatsapp_message_id: string;
  caption: string | null;
  image_data: string;
  image_mime: string;
  ocr_text: null;
};

export function buildWhatsAppInvoiceInsert(input: {
  orgId: string;
  from: string;
  caption: string | null;
  messageId: string;
  imageData: string;
  imageMime: string;
  restaurants: Restaurant[];
  aliases: RestaurantAlias[];
}): WhatsAppInvoiceInsert {
  const route = matchRestaurant(
    { ocrText: input.caption, caption: input.caption, from: input.from, group: null },
    input.restaurants,
    input.aliases,
  );
  return {
    org_id: input.orgId,
    restaurant_id: route?.restaurant.id ?? null,
    status: "received",
    source: "whatsapp",
    terms: "Net 15",
    whatsapp_from: input.from,
    whatsapp_group: null,
    whatsapp_message_id: input.messageId,
    caption: input.caption,
    image_data: input.imageData,
    image_mime: input.imageMime,
    ocr_text: null,
  };
}
