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
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  from?: { id?: number; username?: string };
  chat?: { id?: number };
};

type TelegramUpdate = {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
};

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
  if (!body || typeof body !== "object") return [];
  const update = body as TelegramUpdate;
  const message = update.message ?? update.channel_post;
  if (!message) return [];

  const chatId = message.chat?.id;
  const rawMessageId = message.message_id;
  const fileId = fileIdFromMessage(message);
  if (chatId == null || rawMessageId == null || !fileId) return [];

  return [
    {
      messageId: `${chatId}:${rawMessageId}`,
      from: senderFrom(message, chatId),
      caption: message.caption?.trim() || null,
      fileId,
    },
  ];
}

export function verifyTelegramSecret(
  secretHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!expectedSecret || !secretHeader) return false;
  return timingSafeEqual(secretHeader, expectedSecret);
}
