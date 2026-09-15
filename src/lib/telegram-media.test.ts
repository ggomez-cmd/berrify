import { describe, expect, it } from "vitest";
import { MAX_INVOICE_IMAGE_BYTES } from "./invoice-image";
import { downloadTelegramFile } from "./telegram-media";
import { mediaBytesToDataUrl } from "./whatsapp-media";

describe("downloadTelegramFile", () => {
  it("calls getFile then downloads the bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://api.telegram.org/botbot-token/getFile?file_id=FILE_1") {
        return Response.json({
          ok: true,
          result: { file_path: "photos/bill.jpg", file_size: 4 },
        });
      }
      if (url === "https://api.telegram.org/file/botbot-token/photos/bill.jpg") {
        return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const media = await downloadTelegramFile("FILE_1", "bot-token", fetchImpl);
    expect(media.mimeType).toBe("image/jpeg");
    expect(media.dataUrl).toBe(mediaBytesToDataUrl(bytes, "image/jpeg"));
    expect([...media.bytes]).toEqual([1, 2, 3, 4]);
  });

  it("sniffs JPEG bytes when Telegram serves octet-stream", async () => {
    const bytes = Uint8Array.from(atob("/9j/4AAQ"), (c) => c.charCodeAt(0));
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        return Response.json({
          ok: true,
          result: { file_path: "photos/bill.jpg", file_size: bytes.byteLength },
        });
      }
      if (url.includes("/file/")) {
        return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const media = await downloadTelegramFile("FILE_1", "bot-token", fetchImpl);
    expect(media.mimeType).toBe("image/jpeg");
    expect(media.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("surfaces Telegram getFile error descriptions", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ ok: false, description: "Bad Request: file is too big" });
    await expect(downloadTelegramFile("FILE_1", "bot-token", fetchImpl)).rejects.toThrow(
      /file is too big/,
    );
  });

  it("rejects photos over the invoice size cap", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/getFile")) {
        return Response.json({
          ok: true,
          result: { file_path: "photos/big.jpg", file_size: MAX_INVOICE_IMAGE_BYTES + 1 },
        });
      }
      return new Response(new Uint8Array(MAX_INVOICE_IMAGE_BYTES + 1));
    };
    await expect(downloadTelegramFile("FILE_1", "bot-token", fetchImpl)).rejects.toThrow(
      /8 MB or smaller/,
    );
  });
});
