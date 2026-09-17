import {
  EMPTY_BOTTLE_AWAIT_PHOTO,
  EMPTY_BOTTLE_CATEGORY,
  EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE,
  EMPTY_BOTTLE_REORDER_LEVEL,
  EMPTY_BOTTLE_UNIT,
  emptyBottleUsageMovement,
  emptyCallbackData,
  emptyConfirmPrompt,
  leftoverEmptyCaption,
  matchEmptyBottle,
  nextEmptyBottleStatus,
  type EmptyBottleCatalogItem,
  type EmptyBottleEventStatus,
} from "../src/lib/empty-bottle";
import { consumeEmptyPhotoPending, markEmptyPhotoPending } from "../src/lib/empty-bottle-pending";
import { downloadTelegramFile } from "../src/lib/telegram-media";
import { buildTelegramInvoiceInsert } from "../src/lib/telegram-invoice";
import type { Restaurant, RestaurantAlias } from "../src/lib/restaurant-route";
import { matchRestaurant } from "../src/lib/restaurant-route";
import {
  parseTelegramUpdate,
  TELEGRAM_SECRET_HEADER,
  verifyTelegramSecret,
  type TelegramInboundImage,
} from "../src/lib/telegram-webhook";
import { identifyEmptyBottle } from "./empty-bottle-identify";

export type TelegramPostEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ORG_ID?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

export type TelegramIngestResult = {
  ok: boolean;
  ingested: number;
  skipped: number;
  errors: string[];
  ignored?: string;
  empty?: string;
};

type EmptyBottleEventRow = {
  id: string;
  org_id: string;
  telegram_message_id: string;
  chat_id: string;
  restaurant_id: string | null;
  proposed_item_id: string;
  proposed_label: string;
  status: EmptyBottleEventStatus;
};

function logTelegramError(context: string, detail: string): void {
  console.error(`telegram ingest ${context}: ${detail}`);
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function supabaseHeaders(serviceRole: string): HeadersInit {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  };
}

async function restGet<T>(
  url: string,
  serviceRole: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: supabaseHeaders(serviceRole),
  });
  if (!response.ok) {
    throw new Error(`Supabase GET ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function restSend(
  url: string,
  serviceRole: string,
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  fetchImpl: typeof fetch,
  extraHeaders?: HeadersInit,
): Promise<Response> {
  return fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      ...supabaseHeaders(serviceRole),
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function loadRouting(
  url: string,
  serviceRole: string,
  orgId: string,
  fetchImpl: typeof fetch,
): Promise<{ restaurants: Restaurant[]; aliases: RestaurantAlias[] }> {
  const restaurants = await restGet<Restaurant[]>(
    url,
    serviceRole,
    `restaurants?org_id=eq.${encodeURIComponent(orgId)}&select=id,name,qbo_company_name,slug`,
    fetchImpl,
  );
  const aliases = await restGet<RestaurantAlias[]>(
    url,
    serviceRole,
    `restaurant_aliases?org_id=eq.${encodeURIComponent(orgId)}&select=restaurant_id,match_kind,match_text`,
    fetchImpl,
  );
  return { restaurants, aliases };
}

async function alreadyIngested(
  url: string,
  serviceRole: string,
  orgId: string,
  messageId: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const rows = await restGet<Array<{ id: string }>>(
    url,
    serviceRole,
    `invoices?org_id=eq.${encodeURIComponent(orgId)}&telegram_message_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`,
    fetchImpl,
  );
  return rows.length > 0;
}

async function insertInvoice(
  url: string,
  serviceRole: string,
  row: ReturnType<typeof buildTelegramInvoiceInsert>,
  fetchImpl: typeof fetch,
): Promise<"inserted" | "duplicate"> {
  const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/invoices`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(serviceRole),
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (response.status === 409) return "duplicate";
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase insert failed (${response.status}): ${detail}`);
  }
  return "inserted";
}

async function ingestOne(
  inbound: TelegramInboundImage,
  env: Required<
    Pick<
      TelegramPostEnv,
      "TELEGRAM_BOT_TOKEN" | "TELEGRAM_ORG_ID" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
    >
  >,
  routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] },
  fetchImpl: typeof fetch,
): Promise<"inserted" | "duplicate"> {
  if (
    await alreadyIngested(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.TELEGRAM_ORG_ID,
      inbound.messageId,
      fetchImpl,
    )
  ) {
    return "duplicate";
  }
  const media = await downloadTelegramFile(inbound.fileId, env.TELEGRAM_BOT_TOKEN, fetchImpl);
  const row = buildTelegramInvoiceInsert({
    orgId: env.TELEGRAM_ORG_ID,
    from: inbound.from,
    caption: inbound.caption,
    messageId: inbound.messageId,
    imageData: media.dataUrl,
    imageMime: media.mimeType,
    restaurants: routing.restaurants,
    aliases: routing.aliases,
  });
  return insertInvoice(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, row, fetchImpl);
}

async function telegramMethod(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Telegram ${method} failed (${response.status}): ${detail}`);
  }
}

async function loadOrgName(
  url: string,
  serviceRole: string,
  orgId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const rows = await restGet<Array<{ name?: string }>>(
    url,
    serviceRole,
    `organizations?id=eq.${encodeURIComponent(orgId)}&select=name&limit=1`,
    fetchImpl,
  );
  return rows[0]?.name?.trim() || "org";
}

async function loadCatalog(
  url: string,
  serviceRole: string,
  orgId: string,
  fetchImpl: typeof fetch,
): Promise<EmptyBottleCatalogItem[]> {
  return restGet<EmptyBottleCatalogItem[]>(
    url,
    serviceRole,
    `inventory_items?org_id=eq.${encodeURIComponent(orgId)}&sku=like.${encodeURIComponent("BV-EB-*")}&select=id,sku,name`,
    fetchImpl,
  );
}

async function ensureCatalogItem(
  url: string,
  serviceRole: string,
  orgId: string,
  sku: string,
  name: string,
  fetchImpl: typeof fetch,
): Promise<EmptyBottleCatalogItem> {
  const existing = await restGet<EmptyBottleCatalogItem[]>(
    url,
    serviceRole,
    `inventory_items?org_id=eq.${encodeURIComponent(orgId)}&sku=eq.${encodeURIComponent(sku)}&select=id,sku,name&limit=1`,
    fetchImpl,
  );
  if (existing[0]) return existing[0];
  const response = await restSend(
    url,
    serviceRole,
    "inventory_items",
    "POST",
    {
      org_id: orgId,
      name,
      sku,
      category: EMPTY_BOTTLE_CATEGORY,
      unit: EMPTY_BOTTLE_UNIT,
      quantity: 0,
      reorder_level: EMPTY_BOTTLE_REORDER_LEVEL,
    },
    fetchImpl,
  );
  if (response.status === 409) {
    const again = await restGet<EmptyBottleCatalogItem[]>(
      url,
      serviceRole,
      `inventory_items?org_id=eq.${encodeURIComponent(orgId)}&sku=eq.${encodeURIComponent(sku)}&select=id,sku,name&limit=1`,
      fetchImpl,
    );
    if (again[0]) return again[0];
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not create bottle item (${response.status}): ${detail}`);
  }
  const created = (await response.json()) as EmptyBottleCatalogItem[];
  if (!created[0]) throw new Error("Could not create bottle item");
  return created[0];
}

async function loadEvent(
  url: string,
  serviceRole: string,
  orgId: string,
  eventId: string,
  fetchImpl: typeof fetch,
): Promise<EmptyBottleEventRow | null> {
  const rows = await restGet<EmptyBottleEventRow[]>(
    url,
    serviceRole,
    `empty_bottle_events?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(eventId)}&select=id,org_id,telegram_message_id,chat_id,restaurant_id,proposed_item_id,proposed_label,status&limit=1`,
    fetchImpl,
  );
  return rows[0] ?? null;
}

async function loadEventByMessage(
  url: string,
  serviceRole: string,
  orgId: string,
  messageId: string,
  fetchImpl: typeof fetch,
): Promise<EmptyBottleEventRow | null> {
  const rows = await restGet<EmptyBottleEventRow[]>(
    url,
    serviceRole,
    `empty_bottle_events?org_id=eq.${encodeURIComponent(orgId)}&telegram_message_id=eq.${encodeURIComponent(messageId)}&select=id,org_id,telegram_message_id,chat_id,restaurant_id,proposed_item_id,proposed_label,status&limit=1`,
    fetchImpl,
  );
  return rows[0] ?? null;
}

async function insertEvent(
  url: string,
  serviceRole: string,
  row: Omit<EmptyBottleEventRow, "id" | "status"> & { status: "pending" },
  fetchImpl: typeof fetch,
): Promise<EmptyBottleEventRow> {
  const response = await restSend(url, serviceRole, "empty_bottle_events", "POST", row, fetchImpl);
  if (response.status === 409) {
    const existing = await loadEventByMessage(url, serviceRole, row.org_id, row.telegram_message_id, fetchImpl);
    if (existing) return existing;
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not save empty-bottle event (${response.status}): ${detail}`);
  }
  const created = (await response.json()) as EmptyBottleEventRow[];
  if (!created[0]) throw new Error("Could not save empty-bottle event");
  return created[0];
}

async function claimEvent(
  url: string,
  serviceRole: string,
  orgId: string,
  eventId: string,
  next: EmptyBottleEventStatus,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const response = await restSend(
    url,
    serviceRole,
    `empty_bottle_events?id=eq.${encodeURIComponent(eventId)}&org_id=eq.${encodeURIComponent(orgId)}&status=eq.pending`,
    "PATCH",
    { status: next },
    fetchImpl,
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not update empty-bottle event (${response.status}): ${detail}`);
  }
  const rows = (await response.json()) as Array<{ id: string }>;
  return rows.length > 0;
}

async function revertEvent(
  url: string,
  serviceRole: string,
  orgId: string,
  eventId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  await restSend(
    url,
    serviceRole,
    `empty_bottle_events?id=eq.${encodeURIComponent(eventId)}&org_id=eq.${encodeURIComponent(orgId)}&status=eq.confirmed`,
    "PATCH",
    { status: "pending" },
    fetchImpl,
  );
}

async function sendConfirmPrompt(
  botToken: string,
  chatId: string,
  event: EmptyBottleEventRow,
  place: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  await telegramMethod(
    botToken,
    "sendMessage",
    {
      chat_id: chatId,
      text: emptyConfirmPrompt(event.proposed_label, place),
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Confirm", callback_data: emptyCallbackData(true, event.id) },
            { text: "Cancel", callback_data: emptyCallbackData(false, event.id) },
          ],
        ],
      },
    },
    fetchImpl,
  );
}

async function handleEmptyPhoto(input: {
  inbound: TelegramInboundImage;
  chatId: number;
  hint: string;
  env: Required<
    Pick<
      TelegramPostEnv,
      "TELEGRAM_BOT_TOKEN" | "TELEGRAM_ORG_ID" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
    >
  > &
    Pick<TelegramPostEnv, "GEMINI_API_KEY" | "GEMINI_MODEL">;
  routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] };
  fetchImpl: typeof fetch;
}): Promise<string> {
  const { inbound, env, routing, fetchImpl } = input;
  const existing = await loadEventByMessage(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.TELEGRAM_ORG_ID,
    inbound.messageId,
    fetchImpl,
  );
  const route = matchRestaurant(
    { ocrText: inbound.caption, caption: inbound.caption, from: inbound.from, group: null },
    routing.restaurants,
    routing.aliases,
  );
  const place =
    route?.restaurant.name ??
    (await loadOrgName(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.TELEGRAM_ORG_ID, fetchImpl));

  if (existing) {
    if (existing.status === "pending") {
      await sendConfirmPrompt(env.TELEGRAM_BOT_TOKEN, String(input.chatId), existing, place, fetchImpl);
    }
    return "duplicate_event";
  }

  if (!env.GEMINI_API_KEY?.trim()) {
    await telegramMethod(
      env.TELEGRAM_BOT_TOKEN,
      "sendMessage",
      { chat_id: input.chatId, text: EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE },
      fetchImpl,
    );
    return "identify_unavailable";
  }

  const media = await downloadTelegramFile(inbound.fileId, env.TELEGRAM_BOT_TOKEN, fetchImpl);
  const catalog = await loadCatalog(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.TELEGRAM_ORG_ID,
    fetchImpl,
  );
  const stripWords = [
    ...routing.restaurants.map((row) => row.name),
    ...routing.aliases.map((row) => row.match_text),
  ];
  const captionHint = leftoverEmptyCaption([inbound.caption, input.hint].filter(Boolean).join(" "), stripWords);
  const proposal = await identifyEmptyBottle({
    imageDataUrl: media.dataUrl,
    catalog,
    captionHint,
    env,
    fetchImpl,
  });
  const match = matchEmptyBottle(proposal, catalog);
  let item: EmptyBottleCatalogItem;
  switch (match.kind) {
    case "existing":
      item = match.item;
      break;
    case "unknown":
      item = match.item;
      break;
    case "create":
      item = await ensureCatalogItem(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        env.TELEGRAM_ORG_ID,
        match.sku,
        match.name,
        fetchImpl,
      );
      break;
    default: {
      const exhaustive: never = match;
      throw exhaustive;
    }
  }

  const event = await insertEvent(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      org_id: env.TELEGRAM_ORG_ID,
      telegram_message_id: inbound.messageId,
      chat_id: String(input.chatId),
      restaurant_id: route?.restaurant.id ?? null,
      proposed_item_id: item.id,
      proposed_label: match.kind === "create" ? match.name : item.name,
      status: "pending",
    },
    fetchImpl,
  );
  await sendConfirmPrompt(env.TELEGRAM_BOT_TOKEN, String(input.chatId), event, place, fetchImpl);
  return "awaiting_confirm";
}

async function handleEmptyCallback(input: {
  eventId: string;
  confirm: boolean;
  callbackQueryId: string;
  chatId: number;
  env: Required<
    Pick<
      TelegramPostEnv,
      "TELEGRAM_BOT_TOKEN" | "TELEGRAM_ORG_ID" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
    >
  >;
  routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] };
  fetchImpl: typeof fetch;
}): Promise<string> {
  const event = await loadEvent(
    input.env.NEXT_PUBLIC_SUPABASE_URL,
    input.env.SUPABASE_SERVICE_ROLE_KEY,
    input.env.TELEGRAM_ORG_ID,
    input.eventId,
    input.fetchImpl,
  );
  if (!event) {
    await telegramMethod(
      input.env.TELEGRAM_BOT_TOKEN,
      "answerCallbackQuery",
      { callback_query_id: input.callbackQueryId, text: "Unknown empty bottle." },
      input.fetchImpl,
    );
    return "unknown_event";
  }

  const action = input.confirm ? "confirm" : "cancel";
  const decision = nextEmptyBottleStatus(event.status, action);
  if (!decision.changed) {
    await telegramMethod(
      input.env.TELEGRAM_BOT_TOKEN,
      "answerCallbackQuery",
      { callback_query_id: input.callbackQueryId, text: "Already handled." },
      input.fetchImpl,
    );
    return "already_handled";
  }

  const claimed = await claimEvent(
    input.env.NEXT_PUBLIC_SUPABASE_URL,
    input.env.SUPABASE_SERVICE_ROLE_KEY,
    input.env.TELEGRAM_ORG_ID,
    event.id,
    decision.next,
    input.fetchImpl,
  );
  if (!claimed) {
    await telegramMethod(
      input.env.TELEGRAM_BOT_TOKEN,
      "answerCallbackQuery",
      { callback_query_id: input.callbackQueryId, text: "Already handled." },
      input.fetchImpl,
    );
    return "already_handled";
  }

  if (decision.applyDebit) {
    const restaurant = event.restaurant_id
      ? input.routing.restaurants.find((row) => row.id === event.restaurant_id)
      : null;
    const movement = emptyBottleUsageMovement({
      orgId: event.org_id,
      itemId: event.proposed_item_id,
      label: event.proposed_label,
      restaurantName: restaurant?.name ?? null,
    });
    try {
      const response = await restSend(
        input.env.NEXT_PUBLIC_SUPABASE_URL,
        input.env.SUPABASE_SERVICE_ROLE_KEY,
        "stock_movements",
        "POST",
        movement,
        input.fetchImpl,
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Could not debit bottle (${response.status}): ${detail}`);
      }
    } catch (err) {
      await revertEvent(
        input.env.NEXT_PUBLIC_SUPABASE_URL,
        input.env.SUPABASE_SERVICE_ROLE_KEY,
        input.env.TELEGRAM_ORG_ID,
        event.id,
        input.fetchImpl,
      );
      throw err;
    }
    await telegramMethod(
      input.env.TELEGRAM_BOT_TOKEN,
      "answerCallbackQuery",
      { callback_query_id: input.callbackQueryId, text: "Debited 1 bottle." },
      input.fetchImpl,
    );
    await telegramMethod(
      input.env.TELEGRAM_BOT_TOKEN,
      "sendMessage",
      { chat_id: input.chatId, text: `Debited 1 bottle of ${event.proposed_label}.` },
      input.fetchImpl,
    );
    return "confirmed";
  }

  await telegramMethod(
    input.env.TELEGRAM_BOT_TOKEN,
    "answerCallbackQuery",
    { callback_query_id: input.callbackQueryId, text: "Cancelled." },
    input.fetchImpl,
  );
  await telegramMethod(
    input.env.TELEGRAM_BOT_TOKEN,
    "sendMessage",
    { chat_id: input.chatId, text: "Empty-bottle debit cancelled." },
    input.fetchImpl,
  );
  return "cancelled";
}

export async function handleTelegramPost(
  request: Request,
  env: TelegramPostEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const orgId = env.TELEGRAM_ORG_ID;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!botToken || !webhookSecret || !orgId || !supabaseUrl || !serviceRole) {
    return json({ ok: false, error: "Telegram ingest is not configured on this Worker." }, 503);
  }

  const rawBody = await request.text();
  const secretHeader = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (!verifyTelegramSecret(secretHeader, webhookSecret)) {
    return json({ ok: false, error: "Invalid secret" }, 403);
  }

  let parsed: unknown;
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const update = parseTelegramUpdate(parsed);
  const configured = {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_ORG_ID: orgId,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
  };

  const needRouting = update.kind !== "ignored";
  let routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] } = {
    restaurants: [],
    aliases: [],
  };
  if (needRouting && update.kind !== "empty_command") {
    try {
      routing = await loadRouting(supabaseUrl, serviceRole, orgId, fetchImpl);
    } catch (err) {
      const errors = [err instanceof Error ? err.message : "Could not load restaurant routing"];
      logTelegramError("routing", errors[0] ?? "Could not load restaurant routing");
      if (update.kind === "photo" && !update.emptyCaption) {
        return json(
          { ok: false, ingested: 0, skipped: 1, errors } satisfies TelegramIngestResult,
          502,
        );
      }
      return json({ ok: false, ingested: 0, skipped: 0, errors } satisfies TelegramIngestResult, 502);
    }
  }

  switch (update.kind) {
    case "ignored":
      logTelegramError("ignored", "no photo or image document");
      return json(
        {
          ok: true,
          ingested: 0,
          skipped: 0,
          errors: [],
          ignored: "no photo or image document",
        } satisfies TelegramIngestResult,
        200,
      );
    case "empty_command": {
      const hint = leftoverEmptyCaption(update.text, []);
      markEmptyPhotoPending(String(update.chatId), hint);
      try {
        await telegramMethod(
          botToken,
          "sendMessage",
          { chat_id: update.chatId, text: EMPTY_BOTTLE_AWAIT_PHOTO },
          fetchImpl,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Could not reply";
        logTelegramError("empty_command", detail);
        return json({ ok: false, ingested: 0, skipped: 0, errors: [detail] } satisfies TelegramIngestResult, 502);
      }
      return json(
        { ok: true, ingested: 0, skipped: 0, errors: [], empty: "awaiting_photo" } satisfies TelegramIngestResult,
        200,
      );
    }
    case "empty_callback": {
      try {
        const empty = await handleEmptyCallback({
          eventId: update.eventId,
          confirm: update.confirm,
          callbackQueryId: update.callbackQueryId,
          chatId: update.chatId,
          env: configured,
          routing,
          fetchImpl,
        });
        return json({ ok: true, ingested: 0, skipped: 0, errors: [], empty } satisfies TelegramIngestResult, 200);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "empty callback failed";
        logTelegramError("empty_callback", detail);
        return json({ ok: false, ingested: 0, skipped: 0, errors: [detail] } satisfies TelegramIngestResult, 502);
      }
    }
    case "photo": {
      const pending = consumeEmptyPhotoPending(String(update.chatId));
      const isEmpty = update.emptyCaption || pending.consumed;
      if (isEmpty) {
        try {
          const empty = await handleEmptyPhoto({
            inbound: update.image,
            chatId: update.chatId,
            hint: pending.hint,
            env: configured,
            routing,
            fetchImpl,
          });
          return json({ ok: true, ingested: 0, skipped: 0, errors: [], empty } satisfies TelegramIngestResult, 200);
        } catch (err) {
          const detail = `${update.image.messageId}: ${err instanceof Error ? err.message : "empty identify failed"}`;
          logTelegramError("empty_photo", detail);
          return json({ ok: false, ingested: 0, skipped: 1, errors: [detail] } satisfies TelegramIngestResult, 502);
        }
      }

      let ingested = 0;
      let skipped = 0;
      const errors: string[] = [];
      try {
        const result = await ingestOne(update.image, configured, routing, fetchImpl);
        if (result === "inserted") ingested += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        const detail = `${update.image.messageId}: ${err instanceof Error ? err.message : "ingest failed"}`;
        logTelegramError("item", detail);
        errors.push(detail);
      }
      if (ingested === 0 && errors.length > 0) {
        return json({ ok: false, ingested, skipped, errors } satisfies TelegramIngestResult, 502);
      }
      return json({ ok: true, ingested, skipped, errors } satisfies TelegramIngestResult, 200);
    }
    default: {
      const exhaustive: never = update;
      return exhaustive;
    }
  }
}
