import { captionHasEmptyIntent, parseEmptyCallbackData, textIsEmptyCommand } from "./empty-bottle";
import { timingSafeEqual } from "./whatsapp-webhook";

export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export type TelegramInboundImage = {
  messageId: string;
  from: string;
  caption: string | null;
  fileId: string;
};

type TelegramPhotoSize = {
  file_id?: string;
  file_size?: number;
};

type TelegramDocument = {
  file_id?: string;
  mime_type?: string;
  file_name?: string;
};

type TelegramMessage = {
  message_id?: number;
  caption?: string;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  from?: { id?: number; username?: string };
  chat?: { id?: number };
};

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  from?: { id?: number; username?: string };
  message?: TelegramMessage;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramParsedUpdate =
  | {
      kind: "empty_callback";
      confirm: boolean;
      eventId: string;
      callbackQueryId: string;
      chatId: number;
    }
  | {
      kind: "empty_command";
      chatId: number;
      from: string;
      text: string;
    }
  | {
      kind: "photo";
      chatId: number;
      emptyCaption: boolean;
      image: TelegramInboundImage;
    }
  | { kind: "ignored" };

function pickLargestPhoto(photos: TelegramPhotoSize[]): string | null {
  let best: { fileId: string; fileSize: number } | null = null;
  for (const photo of photos) {
    const fileId = photo.file_id?.trim();
    if (!fileId) continue;
    const fileSize = photo.file_size ?? 0;
    if (!best || fileSize >= best.fileSize) {
      best = { fileId, fileSize };
    }
  }
  return best?.fileId ?? null;
}

function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.toLowerCase().startsWith("image/") && mime.toLowerCase() !== "image/svg+xml";
}

function senderFrom(message: TelegramMessage, chatId: number): string {
  if (message.from?.username?.trim()) return `@${message.from.username.trim()}`;
  if (message.from?.id != null) return String(message.from.id);
  return String(chatId);
}

function fileIdFromMessage(message: TelegramMessage): string | null {
  if (message.photo?.length) return pickLargestPhoto(message.photo);
  const document = message.document;
  if (document?.file_id && isImageMime(document.mime_type)) {
    return document.file_id.trim();
  }
  return null;
}

export function parseTelegramInboundImages(body: unknown): TelegramInboundImage[] {
  const parsed = parseTelegramUpdate(body);
  return parsed.kind === "photo" ? [parsed.image] : [];
}

export function parseTelegramUpdate(body: unknown): TelegramParsedUpdate {
  if (!body || typeof body !== "object") return { kind: "ignored" };
  const update = body as TelegramUpdate;

  const callback = update.callback_query;
  if (callback) {
    const parsed = parseEmptyCallbackData(callback.data);
    const chatId = callback.message?.chat?.id ?? callback.from?.id;
    const callbackQueryId = callback.id?.trim();
    if (parsed && chatId != null && callbackQueryId) {
      return {
        kind: "empty_callback",
        confirm: parsed.confirm,
        eventId: parsed.eventId,
        callbackQueryId,
        chatId,
      };
    }
    return { kind: "ignored" };
  }

  const message = update.message ?? update.channel_post;
  if (!message) return { kind: "ignored" };

  const chatId = message.chat?.id;
  if (chatId == null) return { kind: "ignored" };

  const fileId = fileIdFromMessage(message);
  const rawMessageId = message.message_id;
  if (fileId && rawMessageId != null) {
    const caption = message.caption?.trim() || null;
    return {
      kind: "photo",
      chatId,
      emptyCaption: captionHasEmptyIntent(caption),
      image: {
        messageId: `${chatId}:${rawMessageId}`,
        from: senderFrom(message, chatId),
        caption,
        fileId,
      },
    };
  }

  const text = message.text?.trim() || null;
  if (text && (textIsEmptyCommand(text) || captionHasEmptyIntent(text))) {
    return {
      kind: "empty_command",
      chatId,
      from: senderFrom(message, chatId),
      text,
    };
  }

  return { kind: "ignored" };
}

export function verifyTelegramSecret(
  secretHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!expectedSecret || !secretHeader) return false;
  return timingSafeEqual(secretHeader, expectedSecret);
}
