import { describe, expect, it } from "vitest";
import { assertTelegramMethodOk } from "./telegram-api";

describe("assertTelegramMethodOk", () => {
  it("accepts HTTP 200 with ok true", () => {
    expect(() => assertTelegramMethodOk("sendMessage", 200, JSON.stringify({ ok: true }))).not.toThrow();
  });

  it("throws Telegram description when JSON ok is false", () => {
    expect(() =>
      assertTelegramMethodOk(
        "sendMessage",
        200,
        JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }),
      ),
    ).toThrow("Telegram sendMessage failed (200): Forbidden: bot was blocked by the user");
  });

  it("does not include a bot token in the error", () => {
    try {
      assertTelegramMethodOk("sendMessage", 400, JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("Bad Request: chat not found");
      expect(message.toLowerCase()).not.toContain("bot");
      expect(message).not.toMatch(/\d{8,}:[A-Za-z0-9_-]+/);
      return;
    }
    throw new Error("expected throw");
  });
});
