import { describe, expect, it } from "vitest";
import {
  parseWhatsAppInboundImages,
  signWhatsAppBody,
  timingSafeEqual,
  verifyWhatsAppSignature,
} from "./whatsapp-webhook";

const IMAGE_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "123456" },
            messages: [
              {
                id: "wamid.HBgLTEST",
                from: "17875550100",
                type: "image",
                image: {
                  id: "MEDIA_1",
                  caption: "Semilla factura",
                  mime_type: "image/jpeg",
                },
              },
              {
                id: "wamid.TEXT",
                from: "17875550100",
                type: "text",
                text: { body: "hello" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parseWhatsAppInboundImages", () => {
  it("keeps image messages and skips text", () => {
    expect(parseWhatsAppInboundImages(IMAGE_PAYLOAD)).toEqual([
      {
        messageId: "wamid.HBgLTEST",
        from: "17875550100",
        caption: "Semilla factura",
        mediaId: "MEDIA_1",
        mimeType: "image/jpeg",
        phoneNumberId: "123456",
      },
    ]);
  });

  it("accepts image documents and rejects PDFs", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.PNG",
                    from: "17875550100",
                    type: "document",
                    document: { id: "DOC_1", mime_type: "image/png", caption: "Kane" },
                  },
                  {
                    id: "wamid.PDF",
                    from: "17875550100",
                    type: "document",
                    document: { id: "DOC_2", mime_type: "application/pdf" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppInboundImages(body)).toEqual([
      {
        messageId: "wamid.PNG",
        from: "17875550100",
        caption: "Kane",
        mediaId: "DOC_1",
        mimeType: "image/png",
        phoneNumberId: null,
      },
    ]);
  });

  it("returns nothing for a non-WhatsApp payload", () => {
    expect(parseWhatsAppInboundImages({ object: "page" })).toEqual([]);
    expect(parseWhatsAppInboundImages(null)).toEqual([]);
  });
});

describe("WhatsApp signature", () => {
  it("accepts a matching HMAC and rejects a wrong one", async () => {
    const body = JSON.stringify(IMAGE_PAYLOAD);
    const header = await signWhatsAppBody(body, "app-secret");
    await expect(verifyWhatsAppSignature(body, header, "app-secret")).resolves.toBe(true);
    await expect(verifyWhatsAppSignature(body, header, "other-secret")).resolves.toBe(false);
    await expect(verifyWhatsAppSignature(body, null, "app-secret")).resolves.toBe(false);
  });

  it("compares signatures in constant time", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
