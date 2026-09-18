import { describe, expect, it } from "vitest";
import {
  consumeEmptyPhotoPending,
  markEmptyPhotoPending,
} from "./empty-bottle-pending";

type PendingRow = {
  org_id: string;
  chat_id: string;
  hint: string;
  expires_at: string;
};

function postgresBackend() {
  const rows = new Map<string, PendingRow>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.supabase.co");
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.pathname.endsWith("/empty_bottle_pending")) {
      throw new Error(`unexpected ${method} ${url.pathname}`);
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as PendingRow;
      rows.set(`${body.org_id}:${body.chat_id}`, body);
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      const orgId = url.searchParams.get("org_id")?.replace(/^eq\./, "") ?? "";
      const chatId = url.searchParams.get("chat_id")?.replace(/^eq\./, "") ?? "";
      const key = `${orgId}:${chatId}`;
      const row = rows.get(key);
      rows.delete(key);
      return Response.json(row ? [row] : []);
    }
    throw new Error(`unexpected ${method}`);
  };
  return { rows, fetchImpl };
}

describe("empty-bottle pending REST", () => {
  it("survives a fresh in-memory Map (simulated Worker isolate)", async () => {
    const postgres = postgresBackend();
    const isolateMemory = new Map<string, unknown>();
    await markEmptyPhotoPending({
      supabaseUrl: "https://example.supabase.co",
      serviceRole: "service-role",
      orgId: "org-1",
      chatId: "-100",
      hint: "rum",
      now: 1_000,
      fetchImpl: postgres.fetchImpl,
    });
    expect(isolateMemory.size).toBe(0);
    expect(postgres.rows.size).toBe(1);

    const otherIsolateMemory = new Map<string, unknown>();
    const consumed = await consumeEmptyPhotoPending({
      supabaseUrl: "https://example.supabase.co",
      serviceRole: "service-role",
      orgId: "org-1",
      chatId: "-100",
      now: 2_000,
      fetchImpl: postgres.fetchImpl,
    });
    expect(otherIsolateMemory.size).toBe(0);
    expect(consumed).toEqual({ consumed: true, hint: "rum" });
    expect(postgres.rows.size).toBe(0);
    await expect(
      consumeEmptyPhotoPending({
        supabaseUrl: "https://example.supabase.co",
        serviceRole: "service-role",
        orgId: "org-1",
        chatId: "-100",
        now: 3_000,
        fetchImpl: postgres.fetchImpl,
      }),
    ).resolves.toEqual({ consumed: false, hint: "" });
  });

  it("ignores an expired pending row", async () => {
    const postgres = postgresBackend();
    await markEmptyPhotoPending({
      supabaseUrl: "https://example.supabase.co",
      serviceRole: "service-role",
      orgId: "org-1",
      chatId: "-100",
      hint: "vodka",
      now: 1_000,
      ttlMs: 10,
      fetchImpl: postgres.fetchImpl,
    });
    await expect(
      consumeEmptyPhotoPending({
        supabaseUrl: "https://example.supabase.co",
        serviceRole: "service-role",
        orgId: "org-1",
        chatId: "-100",
        now: 1_020,
        fetchImpl: postgres.fetchImpl,
      }),
    ).resolves.toEqual({ consumed: false, hint: "" });
  });
});
