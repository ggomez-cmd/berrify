import { describe, expect, it } from "vitest";
import { DROUYN_OCR, JOSE_SANTIAGO_OCR, NORTHWESTERN_OCR, SANTURCE_OCR } from "./invoice-fixtures";
import { matchRestaurant, type Restaurant, type RestaurantAlias } from "./restaurant-route";

const semilla: Restaurant = {
  id: "r-semilla",
  name: "Semilla",
  qbo_company_name: "Semilla",
  slug: "semilla",
};
const kane: Restaurant = {
  id: "r-kane",
  name: "Kane Rum Bar",
  qbo_company_name: "Kane Rum Bar",
  slug: "kane-rum-bar",
};

const aliases: RestaurantAlias[] = [
  { restaurant_id: kane.id, match_kind: "whatsapp_group", match_text: "kane invoices" },
  { restaurant_id: semilla.id, match_kind: "whatsapp_group", match_text: "semilla kitchen" },
  { restaurant_id: kane.id, match_kind: "whatsapp_from", match_text: "+17875550111" },
  { restaurant_id: semilla.id, match_kind: "caption", match_text: "semilla" },
  { restaurant_id: kane.id, match_kind: "customer", match_text: "kane rum bar" },
  { restaurant_id: kane.id, match_kind: "customer", match_text: "kanerb" },
  { restaurant_id: kane.id, match_kind: "customer", match_text: "can enterprise deux" },
  { restaurant_id: kane.id, match_kind: "customer", match_text: "1060 ave ashford" },
  { restaurant_id: semilla.id, match_kind: "customer", match_text: "semilla" },
  { restaurant_id: semilla.id, match_kind: "customer", match_text: "57 delcasse" },
  { restaurant_id: semilla.id, match_kind: "customer", match_text: "57 c/del" },
];

describe("matchRestaurant", () => {
  it("prefers the WhatsApp group over sold-to text", () => {
    const route = matchRestaurant(
      { ocrText: JOSE_SANTIAGO_OCR, group: "Kane invoices" },
      [semilla, kane],
      aliases,
    );
    expect(route?.restaurant.slug).toBe("kane-rum-bar");
    expect(route?.match_kind).toBe("whatsapp_group");
  });

  it("routes a forwarded Semilla caption", () => {
    const route = matchRestaurant(
      { ocrText: DROUYN_OCR, caption: "semilla factura" },
      [semilla, kane],
      aliases,
    );
    expect(route?.restaurant.slug).toBe("semilla");
    expect(route?.match_kind).toBe("caption");
  });

  it("reads Kane Rum Bar from the Drouyn sold-to", () => {
    const route = matchRestaurant({ ocrText: DROUYN_OCR }, [semilla, kane], aliases);
    expect(route?.restaurant.slug).toBe("kane-rum-bar");
    expect(route?.match_kind).toBe("customer");
  });

  it("reads Semilla from Jose Santiago and Northwestern", () => {
    expect(matchRestaurant({ ocrText: JOSE_SANTIAGO_OCR }, [semilla, kane], aliases)?.restaurant.slug).toBe(
      "semilla",
    );
    expect(matchRestaurant({ ocrText: NORTHWESTERN_OCR }, [semilla, kane], aliases)?.restaurant.slug).toBe(
      "semilla",
    );
  });

  it("reads Kane from a Santurce ship-to", () => {
    expect(matchRestaurant({ ocrText: SANTURCE_OCR }, [semilla, kane], aliases)?.restaurant.slug).toBe(
      "kane-rum-bar",
    );
  });

  it("does not guess from CAN ENTERPRISE alone", () => {
    const route = matchRestaurant(
      { ocrText: "CAN ENTERPRISE LLC\nUnknown vendor bill" },
      [semilla, kane],
      aliases,
    );
    expect(route).toBeNull();
  });
});
