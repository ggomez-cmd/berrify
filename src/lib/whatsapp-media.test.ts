import { describe, expect, it } from "vitest";
import { downloadWhatsAppMedia, mediaBytesToDataUrl } from "./whatsapp-media";
import { MAX_INVOICE_IMAGE_BYTES } from "./invoice-image";

describe("downloadWhatsAppMedia", () => {
  it("looks up Graph media then downloads the bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://graph.facebook.com/v21.0/MEDIA_1") {
        return Response.json({
          url: "https://lookaside.fbsbx.com/file",
          mime_type: "image/jpeg",
        });
      }
      if (url === "https://lookaside.fbsbx.com/file") {
        return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const media = await downloadWhatsAppMedia("MEDIA_1", "token", fetchImpl);
    expect(media.mimeType).toBe("image/jpeg");
    expect(media.dataUrl).toBe(mediaBytesToDataUrl(bytes, "image/jpeg"));
    expect([...media.bytes]).toEqual([1, 2, 3, 4]);
  });

  it("rejects photos over the invoice size cap", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        return Response.json({ url: "https://lookaside.fbsbx.com/file", mime_type: "image/jpeg" });
      }
      return new Response(new Uint8Array(MAX_INVOICE_IMAGE_BYTES + 1));
    };
    await expect(downloadWhatsAppMedia("MEDIA_1", "token", fetchImpl)).rejects.toThrow(
      /8 MB or smaller/,
    );
  });
});
