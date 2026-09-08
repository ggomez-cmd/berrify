export type RestaurantMatchKind = "whatsapp_group" | "whatsapp_from" | "caption" | "customer";

export type RestaurantAlias = {
  restaurant_id: string;
  match_kind: RestaurantMatchKind;
  match_text: string;
};

export type Restaurant = {
  id: string;
  name: string;
  qbo_company_name: string;
  slug: string;
};

export type RestaurantRoute = {
  restaurant: Restaurant;
  match_kind: RestaurantMatchKind;
  match_text: string;
};

const KIND_ORDER: RestaurantMatchKind[] = ["whatsapp_group", "whatsapp_from", "caption", "customer"];

export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchRestaurant(
  input: {
    ocrText?: string | null;
    caption?: string | null;
    group?: string | null;
    from?: string | null;
  },
  restaurants: Restaurant[],
  aliases: RestaurantAlias[],
): RestaurantRoute | null {
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const ranked = [...aliases].sort((a, b) => {
    const kind = KIND_ORDER.indexOf(a.match_kind) - KIND_ORDER.indexOf(b.match_kind);
    if (kind !== 0) return kind;
    return b.match_text.length - a.match_text.length;
  });

  for (const alias of ranked) {
    const hay = haystackFor(alias.match_kind, input);
    if (!hay) continue;
    if (!foldText(hay).includes(foldText(alias.match_text))) continue;
    const restaurant = byId.get(alias.restaurant_id);
    if (!restaurant) continue;
    return { restaurant, match_kind: alias.match_kind, match_text: alias.match_text };
  }
  return null;
}

export function restaurantFileSlug(restaurant: Pick<Restaurant, "slug" | "qbo_company_name">): string {
  return restaurant.slug || restaurant.qbo_company_name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}

function haystackFor(
  kind: RestaurantMatchKind,
  input: { ocrText?: string | null; caption?: string | null; group?: string | null; from?: string | null },
): string | null {
  switch (kind) {
    case "whatsapp_group":
      return input.group ?? null;
    case "whatsapp_from":
      return input.from ?? null;
    case "caption":
      return input.caption ?? null;
    case "customer":
      return input.ocrText ?? null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
