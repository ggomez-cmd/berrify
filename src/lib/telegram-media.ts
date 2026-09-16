import { MAX_INVOICE_IMAGE_BYTES, rasterMimeForPhoto } from "./invoice-image";
import { mediaBytesToDataUrl } from "./whatsapp-media";

export type DownloadedTelegramMedia = {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl: string;
};

export async function downloadTelegramFile(
  fileId: string,
  botToken: string,
  fetchImpl: typeof fetch,
): Promise<DownloadedTelegramMedia> {
  const metaResponse = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!metaResponse.ok) {
    throw new Error(`Telegram getFile failed (${metaResponse.status})`);
  }
  const meta = (await metaResponse.json()) as {
    ok?: boolean;
    description?: string;
    result?: { file_path?: string; file_size?: number };
  };
  const filePath = meta.result?.file_path;
  if (!meta.ok || !filePath) {
    throw new Error(meta.description?.trim() || "Telegram getFile returned no file path");
  }
  if ((meta.result?.file_size ?? 0) > MAX_INVOICE_IMAGE_BYTES) {
    throw new Error("Invoice photo must be 8 MB or smaller.");
  }

  const fileResponse = await fetchImpl(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileResponse.ok) {
    throw new Error(`Telegram file download failed (${fileResponse.status})`);
  }
  const declared = (fileResponse.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
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
