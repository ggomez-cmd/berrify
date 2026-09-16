import { MAX_INVOICE_IMAGE_BYTES, rasterMimeForPhoto } from "./invoice-image";

const GRAPH_VERSION = "v21.0";

export type DownloadedWhatsAppMedia = {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl: string;
};

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function mediaBytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${uint8ToBase64(bytes)}`;
}

export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<DownloadedWhatsAppMedia> {
  const metaResponse = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaResponse.ok) {
    throw new Error(`WhatsApp media lookup failed (${metaResponse.status})`);
  }
  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error("WhatsApp media lookup returned no URL");
  }

  const fileResponse = await fetchImpl(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileResponse.ok) {
    throw new Error(`WhatsApp media download failed (${fileResponse.status})`);
  }
  const declared = (meta.mime_type || fileResponse.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  const buffer = await fileResponse.arrayBuffer();
  if (buffer.byteLength > MAX_INVOICE_IMAGE_BYTES) {
    throw new Error("Invoice photo must be 8 MB or smaller.");
  }
  const bytes = new Uint8Array(buffer);
  const mimeType = rasterMimeForPhoto(bytes, declared);
  return {
    bytes,
    mimeType,
    dataUrl: mediaBytesToDataUrl(bytes, mimeType),
  };
}
