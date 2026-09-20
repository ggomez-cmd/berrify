import { matchRestaurant, type Restaurant, type RestaurantAlias } from "./restaurant-route";

export type TelegramInvoiceInsert = {
  org_id: string;
  restaurant_id: string | null;
  status: "received";
  source: "telegram";
  terms: "Net 15";
  telegram_from: string;
  telegram_message_id: string;
  telegram_media_group_id: string | null;
  caption: string | null;
  image_data: string;
  image_mime: string;
  ocr_text: null;
};

export function buildTelegramInvoiceInsert(input: {
  orgId: string;
  from: string;
  caption: string | null;
  messageId: string;
  mediaGroupId?: string | null;
  imageData: string;
  imageMime: string;
  restaurants: Restaurant[];
  aliases: RestaurantAlias[];
}): TelegramInvoiceInsert {
  const route = matchRestaurant(
    { ocrText: input.caption, caption: input.caption, from: input.from, group: null },
    input.restaurants,
    input.aliases,
  );
  return {
    org_id: input.orgId,
    restaurant_id: route?.restaurant.id ?? null,
    status: "received",
    source: "telegram",
    terms: "Net 15",
    telegram_from: input.from,
    telegram_message_id: input.messageId,
    telegram_media_group_id: input.mediaGroupId ?? null,
    caption: input.caption,
    image_data: input.imageData,
    image_mime: input.imageMime,
    ocr_text: null,
  };
}
