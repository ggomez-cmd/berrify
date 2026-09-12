export type WhatsAppInboundImage = {
  messageId: string;
  from: string;
  caption: string | null;
  mediaId: string;
  mimeType: string | null;
  phoneNumberId: string | null;
};

type WhatsAppChangeValue = {
  metadata?: { phone_number_id?: string };
  messages?: Array<{
    id?: string;
    from?: string;
    type?: string;
    image?: { id?: string; caption?: string; mime_type?: string };
    document?: { id?: string; caption?: string; mime_type?: string; filename?: string };
  }>;
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: WhatsAppChangeValue;
    }>;
  }>;
};

function isImageMime(mime: string | null | undefined): boolean {
  if (!mime) return true;
  return mime.toLowerCase().startsWith("image/") && mime.toLowerCase() !== "image/svg+xml";
}

export function parseWhatsAppInboundImages(body: unknown): WhatsAppInboundImage[] {
  if (!body || typeof body !== "object") return [];
  const payload = body as WhatsAppWebhookBody;
  if (payload.object !== "whatsapp_business_account") return [];
  const found: WhatsAppInboundImage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id ?? null;
      for (const message of value?.messages ?? []) {
        const messageId = message.id?.trim();
        const from = message.from?.trim();
        if (!messageId || !from) continue;

        if (message.type === "image" && message.image?.id) {
          const mimeType = message.image.mime_type ?? "image/jpeg";
          if (!isImageMime(mimeType)) continue;
          found.push({
            messageId,
            from,
            caption: message.image.caption?.trim() || null,
            mediaId: message.image.id,
            mimeType,
            phoneNumberId,
          });
          continue;
        }

        if (message.type === "document" && message.document?.id) {
          const mimeType = message.document.mime_type ?? null;
          if (!isImageMime(mimeType)) continue;
          found.push({
            messageId,
            from,
            caption: message.document.caption?.trim() || null,
            mediaId: message.document.id,
            mimeType,
            phoneNumberId,
          });
        }
      }
    }
  }

  return found;
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!appSecret || !signatureHeader) return false;
  const expected = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, expected.toLowerCase());
}

export async function signWhatsAppBody(rawBody: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}
