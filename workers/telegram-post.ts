import { buildTelegramInvoiceInsert } from "../src/lib/telegram-invoice";
import { downloadTelegramFile } from "../src/lib/telegram-media";
import type { Restaurant, RestaurantAlias } from "../src/lib/restaurant-route";
import {
  parseTelegramInboundImages,
  TELEGRAM_SECRET_HEADER,
  verifyTelegramSecret,
  type TelegramInboundImage,
} from "../src/lib/telegram-webhook";

export type TelegramPostEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ORG_ID?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type TelegramIngestResult = {
  ok: boolean;
  ingested: number;
  skipped: number;
  errors: string[];
  ignored?: string;
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

  const inbound = parseTelegramInboundImages(parsed);

  if (inbound.length === 0) {
    const ignored = "no photo or image document";
    logTelegramError("ignored", ignored);
    return json(
      { ok: true, ingested: 0, skipped: 0, errors: [], ignored } satisfies TelegramIngestResult,
      200,
    );
  }

  let routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] };
  try {
    routing = await loadRouting(supabaseUrl, serviceRole, orgId, fetchImpl);
  } catch (err) {
    const errors = [err instanceof Error ? err.message : "Could not load restaurant routing"];
    logTelegramError("routing", errors[0] ?? "Could not load restaurant routing");
    return json(
      {
        ok: false,
        ingested: 0,
        skipped: inbound.length,
        errors,
      } satisfies TelegramIngestResult,
      502,
    );
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];
  const configured = {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_ORG_ID: orgId,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  };

  for (const message of inbound) {
    try {
      const result = await ingestOne(message, configured, routing, fetchImpl);
      if (result === "inserted") ingested += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      const detail = `${message.messageId}: ${err instanceof Error ? err.message : "ingest failed"}`;
      logTelegramError("item", detail);
      errors.push(detail);
    }
  }

  const allFailed = ingested === 0 && errors.length > 0 && errors.length === inbound.length;
  if (allFailed) {
    return json({ ok: false, ingested, skipped, errors } satisfies TelegramIngestResult, 502);
  }

  return json({ ok: true, ingested, skipped, errors } satisfies TelegramIngestResult, 200);
}
