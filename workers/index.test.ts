import { describe, expect, it } from "vitest";
import { handleApi, type WorkerEnv } from "./index";

const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response("assets") },
  WHATSAPP_VERIFY_TOKEN: "demo-verify",
};

function api(path: string, init?: RequestInit): Promise<Response> {
  return handleApi(new Request(`https://berrify.example${path}`, init), env);
}

describe("Worker API", () => {
  it("returns health JSON", async () => {
    const response = await api("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "berrify" });
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

  it("returns 501 for WhatsApp POSTs until ingest is wired", async () => {
    const response = await api("/api/webhooks/whatsapp", { method: "POST", body: "{}" });
    expect(response.status).toBe(501);
  });

  it("rejects non-GET health requests", async () => {
    const response = await api("/api/health", { method: "POST" });
    expect(response.status).toBe(405);
  });
});
