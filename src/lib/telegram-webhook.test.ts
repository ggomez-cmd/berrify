import { describe, expect, it } from "vitest";
import { parseTelegramInboundImages, parseTelegramUpdate, verifyTelegramSecret } from "./telegram-webhook";

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
        mediaGroupId: null,
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
        mediaGroupId: null,
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

  it("keeps Telegram album media_group_id", () => {
    expect(
      parseTelegramInboundImages({
        message: {
          message_id: 50,
          caption: "page 2",
          media_group_id: "album-9",
          chat: { id: -100 },
          photo: [{ file_id: "P2", file_size: 10 }],
        },
      }),
    ).toEqual([
      {
        messageId: "-100:50",
        from: "-100",
        caption: "page 2",
        fileId: "P2",
        mediaGroupId: "album-9",
      },
    ]);
  });

  it("returns nothing for a non-photo payload", () => {
    expect(parseTelegramInboundImages({ update_id: 1 })).toEqual([]);
    expect(parseTelegramInboundImages(null)).toEqual([]);
  });
});

describe("parseTelegramUpdate empty intent", () => {
  it("flags a caption that contains empty", () => {
    expect(
      parseTelegramUpdate({
        ...PHOTO_UPDATE,
        message: { ...PHOTO_UPDATE.message, caption: "empty Semilla" },
      }),
    ).toMatchObject({
      kind: "photo",
      emptyCaption: true,
      image: { caption: "empty Semilla", fileId: "LARGE" },
    });
  });

  it("keeps invoice captions unmarked", () => {
    expect(parseTelegramUpdate(PHOTO_UPDATE)).toMatchObject({
      kind: "photo",
      emptyCaption: false,
    });
  });

  it("parses /empty and confirm callbacks", () => {
    expect(
      parseTelegramUpdate({
        message: { message_id: 8, chat: { id: -100 }, text: "/empty" },
      }),
    ).toEqual({
      kind: "empty_command",
      chatId: -100,
      from: "-100",
      text: "/empty",
      replyToMessageId: 8,
    });
    expect(
      parseTelegramUpdate({
        message: { message_id: 9, chat: { id: -100 }, text: "/empty@berrify.bot" },
      }),
    ).toMatchObject({ kind: "empty_command", text: "/empty@berrify.bot" });
    expect(
      parseTelegramUpdate({
        message: { message_id: 10, chat: { id: -100 }, text: "/empty@foo-bot" },
      }),
    ).toMatchObject({ kind: "empty_command", text: "/empty@foo-bot" });
    expect(
      parseTelegramUpdate({
        message: { message_id: 11, chat: { id: -100 }, text: "/\u200Bempty" },
      }),
    ).toMatchObject({ kind: "empty_command", text: "/empty" });
    expect(parseTelegramUpdate(PHOTO_UPDATE).kind).toBe("photo");
    expect(parseTelegramUpdate(PHOTO_UPDATE)).toMatchObject({ emptyCaption: false });
    expect(
      parseTelegramUpdate({
        callback_query: {
          id: "cb-1",
          data: "empty:ok:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          message: { chat: { id: -100 } },
        },
      }),
    ).toEqual({
      kind: "empty_callback",
      confirm: true,
      eventId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      callbackQueryId: "cb-1",
      chatId: -100,
    });
    expect(
      parseTelegramUpdate({
        callback_query: {
          id: "cb-2",
          data: "empty:no:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          from: { id: 9 },
        },
      }),
    ).toMatchObject({ kind: "empty_callback", confirm: false, chatId: 9 });
  });

  it("treats a bot_command entity /empty as empty even when surrounding text is odd", () => {
    expect(
      parseTelegramUpdate({
        message: {
          message_id: 12,
          chat: { id: 99 },
          from: { id: 7, username: "cook" },
          text: "xx/emptyyy",
          entities: [{ type: "bot_command", offset: 2, length: 6 }],
        },
      }),
    ).toEqual({
      kind: "empty_command",
      chatId: 99,
      from: "@cook",
      text: "xx/emptyyy",
      replyToMessageId: 12,
    });
    expect(
      parseTelegramUpdate({
        message: {
          message_id: 13,
          chat: { id: 99 },
          text: "xx/empty@berrify.botyy",
          entities: [{ type: "bot_command", offset: 2, length: 18 }],
        },
      }),
    ).toMatchObject({ kind: "empty_command", text: "xx/empty@berrify.botyy", replyToMessageId: 13 });
    expect(
      parseTelegramUpdate({
        message: {
          message_id: 14,
          chat: { id: 99 },
          text: "hello",
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        },
      }),
    ).toMatchObject({ kind: "ignored", text: "hello", chatId: 99, replyToMessageId: 14 });
  });
});

describe("Telegram secret header", () => {
  it("accepts a matching secret and rejects a wrong one", () => {
    expect(verifyTelegramSecret("hook-secret", "hook-secret")).toBe(true);
    expect(verifyTelegramSecret("hook-secret", "other-secret")).toBe(false);
    expect(verifyTelegramSecret(null, "hook-secret")).toBe(false);
  });
});
