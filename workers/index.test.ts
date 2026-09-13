import { describe, expect, it } from "vitest";
import { TELEGRAM_SECRET_HEADER } from "../src/lib/telegram-webhook";
import { signWhatsAppBody } from "../src/lib/whatsapp-webhook";
import worker, { handleApi, redirectToHttps, type WorkerEnv } from "./index";

const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response("assets") },
  WHATSAPP_VERIFY_TOKEN: "demo-verify",
};

const ingestEnv: WorkerEnv = {
  ...env,
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_ACCESS_TOKEN: "graph-token",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  WHATSAPP_ORG_ID: "org-1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  TELEGRAM_BOT_TOKEN: "bot-token",
  TELEGRAM_WEBHOOK_SECRET: "hook-secret",
  TELEGRAM_ORG_ID: "org-1",
};

function api(
  path: string,
  init?: RequestInit,
  workerEnv: WorkerEnv = env,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  return handleApi(new Request(`https://berrify.example${path}`, init), workerEnv, fetchImpl);
}

const IMAGE_BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "123456" },
            messages: [
              {
                id: "wamid.HBgLTEST",
                from: "17875550100",
                type: "image",
                image: {
                  id: "MEDIA_1",
                  caption: "Semilla factura",
                  mime_type: "image/jpeg",
                },
              },
            ],
          },
        },
      ],
    },
  ],
});

const TELEGRAM_PHOTO_BODY = JSON.stringify({
  update_id: 1001,
  message: {
    message_id: 42,
    caption: "Semilla factura",
    from: { id: 777, username: "cook" },
    chat: { id: -100 },
    photo: [
      { file_id: "SMALL", file_size: 100 },
      { file_id: "FILE_1", file_size: 9000 },
    ],
  },
});

const TELEGRAM_TEXT_BODY = JSON.stringify({
  update_id: 1002,
  message: {
    message_id: 43,
    chat: { id: -100 },
    text: "hello",
  },
});

const TEXT_BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "123456" },
            messages: [
              {
                id: "wamid.TEXT",
                from: "17875550100",
                type: "text",
                text: { body: "hello" },
              },
            ],
          },
        },
      ],
    },
  ],
});

function mockIngestFetch(options?: { alreadyExists?: boolean; insertStatus?: number }) {
  const inserted: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "https://graph.facebook.com/v21.0/MEDIA_1") {
      return Response.json({
        url: "https://lookaside.fbsbx.com/file",
        mime_type: "image/jpeg",
      });
    }
    if (url === "https://lookaside.fbsbx.com/file") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url === "https://api.telegram.org/botbot-token/getFile?file_id=FILE_1") {
      return Response.json({
        ok: true,
        result: { file_path: "photos/bill.jpg", file_size: 3 },
      });
    }
    if (url === "https://api.telegram.org/file/botbot-token/photos/bill.jpg") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url.includes("/rest/v1/restaurants")) {
      return Response.json([
        { id: "r-semilla", name: "Semilla", qbo_company_name: "Semilla", slug: "semilla" },
      ]);
    }
    if (url.includes("/rest/v1/restaurant_aliases")) {
      return Response.json([
        { restaurant_id: "r-semilla", match_kind: "caption", match_text: "semilla" },
      ]);
    }
    if (url.includes("/rest/v1/invoices") && method === "GET") {
      return Response.json(options?.alreadyExists ? [{ id: "inv-1" }] : []);
    }
    if (url.includes("/rest/v1/invoices") && method === "POST") {
      inserted.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(null, { status: options?.insertStatus ?? 201 });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { fetchImpl, inserted };
}

describe("Worker API", () => {
  it("returns health JSON", async () => {
    const response = await api("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "berrify" });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("treats a trailing slash as the same health route", async () => {
    const response = await api("/api/health/");
    expect(response.status).toBe(200);
  });

  it("rejects unknown API paths", async () => {
    const response = await api("/api/nope");
    expect(response.status).toBe(404);
  });

  it("verifies the WhatsApp webhook challenge", async () => {
    const response = await api(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=demo-verify&hub.challenge=abc123",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("rejects a bad WhatsApp verify token", async () => {
    const response = await api(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
    );
    expect(response.status).toBe(403);
  });

  it("returns 503 for WhatsApp POSTs when ingest secrets are missing", async () => {
    const response = await api("/api/webhooks/whatsapp", { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a WhatsApp POST with a bad signature", async () => {
    const response = await api(
      "/api/webhooks/whatsapp",
      {
        method: "POST",
        headers: { "X-Hub-Signature-256": "sha256=deadbeef" },
        body: IMAGE_BODY,
      },
      ingestEnv,
    );
    expect(response.status).toBe(403);
  });

  it("acks text-only WhatsApp POSTs without inserting", async () => {
    const { fetchImpl, inserted } = mockIngestFetch();
    const signature = await signWhatsAppBody(TEXT_BODY, "app-secret");
    const response = await api(
      "/api/webhooks/whatsapp",
      {
        method: "POST",
        headers: { "X-Hub-Signature-256": signature },
        body: TEXT_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 0,
      skipped: 0,
      errors: [],
    });
    expect(inserted).toEqual([]);
  });

  it("downloads a WhatsApp image and inserts a received invoice", async () => {
    const { fetchImpl, inserted } = mockIngestFetch();
    const signature = await signWhatsAppBody(IMAGE_BODY, "app-secret");
    const response = await api(
      "/api/webhooks/whatsapp",
      {
        method: "POST",
        headers: { "X-Hub-Signature-256": signature },
        body: IMAGE_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 1,
      skipped: 0,
      errors: [],
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      org_id: "org-1",
      restaurant_id: "r-semilla",
      status: "received",
      source: "whatsapp",
      whatsapp_message_id: "wamid.HBgLTEST",
      caption: "Semilla factura",
      ocr_text: null,
    });
  });

  it("returns 503 for Telegram POSTs when ingest secrets are missing", async () => {
    const response = await api("/api/webhooks/telegram", { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a Telegram POST with a bad secret header", async () => {
    const response = await api(
      "/api/webhooks/telegram",
      {
        method: "POST",
        headers: { [TELEGRAM_SECRET_HEADER]: "wrong" },
        body: TELEGRAM_PHOTO_BODY,
      },
      ingestEnv,
    );
    expect(response.status).toBe(403);
  });

  it("acks text-only Telegram POSTs without inserting", async () => {
    const { fetchImpl, inserted } = mockIngestFetch();
    const response = await api(
      "/api/webhooks/telegram",
      {
        method: "POST",
        headers: { [TELEGRAM_SECRET_HEADER]: "hook-secret" },
        body: TELEGRAM_TEXT_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 0,
      skipped: 0,
      errors: [],
    });
    expect(inserted).toEqual([]);
  });

  it("downloads a Telegram photo and inserts a received invoice", async () => {
    const { fetchImpl, inserted } = mockIngestFetch();
    const response = await api(
      "/api/webhooks/telegram",
      {
        method: "POST",
        headers: { [TELEGRAM_SECRET_HEADER]: "hook-secret" },
        body: TELEGRAM_PHOTO_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 1,
      skipped: 0,
      errors: [],
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      org_id: "org-1",
      restaurant_id: "r-semilla",
      status: "received",
      source: "telegram",
      telegram_message_id: "-100:42",
      caption: "Semilla factura",
      ocr_text: null,
    });
  });

  it("treats a duplicate Telegram message id as success", async () => {
    const { fetchImpl, inserted } = mockIngestFetch({ alreadyExists: true });
    const response = await api(
      "/api/webhooks/telegram",
      {
        method: "POST",
        headers: { [TELEGRAM_SECRET_HEADER]: "hook-secret" },
        body: TELEGRAM_PHOTO_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 0,
      skipped: 1,
      errors: [],
    });
    expect(inserted).toEqual([]);
  });

  it("treats a duplicate WhatsApp message id as success", async () => {
    const { fetchImpl, inserted } = mockIngestFetch({ alreadyExists: true });
    const signature = await signWhatsAppBody(IMAGE_BODY, "app-secret");
    const response = await api(
      "/api/webhooks/whatsapp",
      {
        method: "POST",
        headers: { "X-Hub-Signature-256": signature },
        body: IMAGE_BODY,
      },
      ingestEnv,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingested: 0,
      skipped: 1,
      errors: [],
    });
    expect(inserted).toEqual([]);
  });

  it("rejects non-GET health requests", async () => {
    const response = await api("/api/health", { method: "POST" });
    expect(response.status).toBe(405);
  });
});

describe("HTTPS redirect", () => {
  it("upgrades public http requests", () => {
    const response = redirectToHttps(new Request("http://berrify.app/login"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe("https://berrify.app/login");
  });

  it("leaves localhost http alone", () => {
    expect(redirectToHttps(new Request("http://localhost:5180/"))).toBeNull();
  });

  it("runs before asset fetch", async () => {
    const response = await worker.fetch(new Request("http://berrify.app/"), env);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://berrify.app/");
  });
});
