import { buildWhatsAppInvoiceInsert } from "../src/lib/whatsapp-invoice";
import { downloadWhatsAppMedia } from "../src/lib/whatsapp-media";
import type { Restaurant, RestaurantAlias } from "../src/lib/restaurant-route";
import {
  parseWhatsAppInboundImages,
  verifyWhatsAppSignature,
  type WhatsAppInboundImage,
} from "../src/lib/whatsapp-webhook";

export type WhatsAppPostEnv = {
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ORG_ID?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type WhatsAppIngestResult = {
  ok: true;
  ingested: number;
  skipped: number;
  errors: string[];
};

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
    `invoices?org_id=eq.${encodeURIComponent(orgId)}&whatsapp_message_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`,
    fetchImpl,
  );
  return rows.length > 0;
}

async function insertInvoice(
  url: string,
  serviceRole: string,
  row: ReturnType<typeof buildWhatsAppInvoiceInsert>,
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
  inbound: WhatsAppInboundImage,
  env: Required<
    Pick<
      WhatsAppPostEnv,
      "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_ORG_ID" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
    >
  >,
  routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] },
  fetchImpl: typeof fetch,
): Promise<"inserted" | "duplicate"> {
  if (
    await alreadyIngested(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.WHATSAPP_ORG_ID,
      inbound.messageId,
      fetchImpl,
    )
  ) {
    return "duplicate";
  }
  const media = await downloadWhatsAppMedia(inbound.mediaId, env.WHATSAPP_ACCESS_TOKEN, fetchImpl);
  const row = buildWhatsAppInvoiceInsert({
    orgId: env.WHATSAPP_ORG_ID,
    from: inbound.from,
    caption: inbound.caption,
    messageId: inbound.messageId,
    imageData: media.dataUrl,
    imageMime: inbound.mimeType ?? media.mimeType,
    restaurants: routing.restaurants,
    aliases: routing.aliases,
  });
  return insertInvoice(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, row, fetchImpl);
}

export async function handleWhatsAppPost(
  request: Request,
  env: WhatsAppPostEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const appSecret = env.WHATSAPP_APP_SECRET;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const orgId = env.WHATSAPP_ORG_ID;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!appSecret || !accessToken || !orgId || !supabaseUrl || !serviceRole) {
    return json({ ok: false, error: "WhatsApp ingest is not configured on this Worker." }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");
  const valid = await verifyWhatsAppSignature(rawBody, signature, appSecret);
  if (!valid) {
    return json({ ok: false, error: "Invalid signature" }, 403);
  }

  let parsed: unknown;
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const inbound = parseWhatsAppInboundImages(parsed).filter((message) => {
    if (!env.WHATSAPP_PHONE_NUMBER_ID) return true;
    return !message.phoneNumberId || message.phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID;
  });

  if (inbound.length === 0) {
    return json({ ok: true, ingested: 0, skipped: 0, errors: [] } satisfies WhatsAppIngestResult, 200);
  }

  let routing: { restaurants: Restaurant[]; aliases: RestaurantAlias[] };
  try {
    routing = await loadRouting(supabaseUrl, serviceRole, orgId, fetchImpl);
  } catch (err) {
    return json(
      {
        ok: true,
        ingested: 0,
        skipped: inbound.length,
        errors: [err instanceof Error ? err.message : "Could not load restaurant routing"],
      } satisfies WhatsAppIngestResult,
      200,
    );
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];
  const configured = {
    WHATSAPP_ACCESS_TOKEN: accessToken,
    WHATSAPP_ORG_ID: orgId,
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
      errors.push(
        `${message.messageId}: ${err instanceof Error ? err.message : "ingest failed"}`,
      );
    }
  }

  return json({ ok: true, ingested, skipped, errors } satisfies WhatsAppIngestResult, 200);
}
