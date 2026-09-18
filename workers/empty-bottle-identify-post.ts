import {
  EMPTY_BOTTLE_CATEGORY,
  EMPTY_BOTTLE_REORDER_LEVEL,
  EMPTY_BOTTLE_UNIT,
  emptyBottleSummaryLabel,
  leftoverEmptyCaption,
  matchEmptyBottle,
  type EmptyBottleCatalogItem,
} from "../src/lib/empty-bottle";
import { parseImageDataUrl, requireSession, sessionAccessToken, type OcrPostEnv } from "./ocr-post";
import { boundFetch } from "./bound-fetch";
import { identifyEmptyBottle } from "./empty-bottle-identify";

export type EmptyBottleIdentifyPostEnv = OcrPostEnv & {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
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
): Promise<Response> {
  return fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      ...supabaseHeaders(serviceRole),
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

async function loadManagerOrg(
  url: string,
  serviceRole: string,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const rows = await restGet<Array<{ org_id: string; role: string }>>(
    url,
    serviceRole,
    `memberships?user_id=eq.${encodeURIComponent(userId)}&select=org_id,role`,
    fetchImpl,
  );
  const manager = rows.find((row) => row.role === "admin" || row.role === "manager");
  if (!manager) throw new Error("forbidden");
  return manager.org_id;
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

async function sessionUserId(
  request: Request,
  env: EmptyBottleIdentifyPostEnv,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = sessionAccessToken(request);
  if (!supabaseUrl || !apiKey || !token) return null;
  const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey,
    },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { id?: string };
  return payload.id ?? null;
}

export async function handleEmptyBottleIdentifyPost(
  request: Request,
  env: EmptyBottleIdentifyPostEnv,
  fetchImpl: typeof fetch = boundFetch,
): Promise<Response> {
  const denied = await requireSession(request, env, fetchImpl);
  if (denied) return denied;

  if (!env.GEMINI_API_KEY?.trim()) {
    return json({ error: "Empty-bottle identify is unavailable" }, 503);
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parseImageDataUrl((body as { image?: unknown }).image);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const restaurantIdRaw = (body as { restaurant_id?: unknown }).restaurant_id;
  const restaurantId = typeof restaurantIdRaw === "string" && restaurantIdRaw.trim() ? restaurantIdRaw.trim() : null;
  const captionRaw = (body as { caption?: unknown }).caption;
  const caption = typeof captionRaw === "string" ? captionRaw : "";

  try {
    const userId = await sessionUserId(request, env, fetchImpl);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const orgId = await loadManagerOrg(supabaseUrl, serviceRole, userId, fetchImpl);
    const catalog = await loadCatalog(supabaseUrl, serviceRole, orgId, fetchImpl);
    const identified = await identifyEmptyBottle({
      imageDataUrl: `data:${parsed.mime};base64,${parsed.content}`,
      catalog,
      captionHint: leftoverEmptyCaption(caption, []),
      env,
      fetchImpl,
    });

    const resolved: Array<{ item: EmptyBottleCatalogItem; label: string; qty: number; sort: number }> = [];
    for (const [sort, line] of identified.lines.entries()) {
      const match = matchEmptyBottle({ sku: line.sku, label: line.label, confidence: 0 }, catalog);
      let item: EmptyBottleCatalogItem;
      switch (match.kind) {
        case "existing":
        case "unknown":
          item = match.item;
          break;
        case "create":
          item = await ensureCatalogItem(supabaseUrl, serviceRole, orgId, match.sku, match.name, fetchImpl);
          catalog.push(item);
          break;
        default: {
          const exhaustive: never = match;
          throw exhaustive;
        }
      }
      resolved.push({
        item,
        label: match.kind === "create" ? match.name : line.label,
        qty: line.qty,
        sort,
      });
    }

    const eventResponse = await restSend(
      supabaseUrl,
      serviceRole,
      "empty_bottle_events",
      "POST",
      {
        org_id: orgId,
        telegram_message_id: null,
        chat_id: null,
        restaurant_id: restaurantId,
        proposed_item_id: resolved[0]?.item.id ?? null,
        proposed_label: emptyBottleSummaryLabel(resolved.length),
        status: "pending",
        source: "app",
        image_data: `data:${parsed.mime};base64,${parsed.content}`,
        image_mime: parsed.mime,
        vision_count: identified.visionCount,
        gemini_count: identified.geminiCount,
      },
      fetchImpl,
    );
    if (!eventResponse.ok) {
      const detail = await eventResponse.text();
      throw new Error(`Could not save empty-bottle event (${eventResponse.status}): ${detail}`);
    }
    const created = (await eventResponse.json()) as Array<{ id: string }>;
    const eventId = created[0]?.id;
    if (!eventId) throw new Error("Could not save empty-bottle event");

    const lineRows = resolved.map((line) => ({
      event_id: eventId,
      org_id: orgId,
      proposed_item_id: line.item.id,
      proposed_label: line.label,
      qty: line.qty,
      sort: line.sort,
    }));
    if (lineRows.length > 0) {
      const linesResponse = await restSend(
        supabaseUrl,
        serviceRole,
        "empty_bottle_lines",
        "POST",
        lineRows,
        fetchImpl,
      );
      if (!linesResponse.ok) {
        const detail = await linesResponse.text();
        throw new Error(`Could not save empty-bottle lines (${linesResponse.status}): ${detail}`);
      }
    }

    return json(
      {
        event_id: eventId,
        vision_count: identified.visionCount,
        gemini_count: identified.geminiCount,
        proposed_label: emptyBottleSummaryLabel(resolved.length),
        lines: lineRows,
      },
      200,
    );
  } catch (err) {
    if (err instanceof Error && err.message === "forbidden") {
      return json({ error: "Forbidden" }, 403);
    }
    if (err instanceof Error && err.message === "identify_unavailable") {
      return json({ error: "Empty-bottle identify is unavailable" }, 503);
    }
    const detail = err instanceof Error ? err.message : "Identify failed";
    return json({ error: detail }, 502);
  }
}
