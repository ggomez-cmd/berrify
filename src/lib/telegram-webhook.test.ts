import { describe, expect, it } from "vitest";
import { parseTelegramInboundImages, verifyTelegramSecret } from "./telegram-webhook";

const PHOTO_UPDATE = {
  update_id: 1001,
  message: {
    message_id: 42,
    caption: "Semilla factura",
    from: { id: 777, username: "cook" },
    chat: { id: -100 },
    photo: [
      { file_id: "SMALL", file_size: 100 },
      { file_id: "LARGE", file_size: 9000 },
    ],
  },
};

describe("parseTelegramInboundImages", () => {
  it("keeps the largest photo and skips text", () => {
    expect(parseTelegramInboundImages(PHOTO_UPDATE)).toEqual([
      {
        messageId: "-100:42",
        from: "@cook",
        caption: "Semilla factura",
        fileId: "LARGE",
      },
    ]);
    expect(
      parseTelegramInboundImages({
        update_id: 2,
        message: {
          message_id: 3,
          chat: { id: 1 },
          text: "hello",
        },
      }),
    ).toEqual([]);
  });

  it("accepts image documents and rejects PDFs", () => {
    expect(
      parseTelegramInboundImages({
        update_id: 3,
        message: {
          message_id: 9,
          caption: "Kane factura",
          from: { id: 777 },
          chat: { id: 55 },
          document: { file_id: "DOC_IMG", mime_type: "image/jpeg", file_name: "bill.jpg" },
        },
      }),
    ).toEqual([
      {
        messageId: "55:9",
        from: "777",
        caption: "Kane factura",
        fileId: "DOC_IMG",
      },
    ]);
    expect(
      parseTelegramInboundImages({
        message: {
          message_id: 9,
          chat: { id: 1 },
          document: { file_id: "DOC", mime_type: "application/pdf" },
        },
      }),
    ).toEqual([]);
  });

  it("returns nothing for a non-photo payload", () => {
    expect(parseTelegramInboundImages({ update_id: 1 })).toEqual([]);
    expect(parseTelegramInboundImages(null)).toEqual([]);
  });
});

describe("Telegram secret header", () => {
  it("accepts a matching secret and rejects a wrong one", () => {
    expect(verifyTelegramSecret("hook-secret", "hook-secret")).toBe(true);
    expect(verifyTelegramSecret("hook-secret", "other-secret")).toBe(false);
    expect(verifyTelegramSecret(null, "hook-secret")).toBe(false);
  });
});
