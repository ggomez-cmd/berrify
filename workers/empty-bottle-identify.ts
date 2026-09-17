import { parseEmptyBottleIdentify, type EmptyBottleCatalogItem, type EmptyBottleProposal } from "../src/lib/empty-bottle";
import { GEMINI_FLASH_MODEL } from "./invoice-extract-post";

export type EmptyBottleIdentifyEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

function extractGeminiJsonText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!first || typeof first !== "object") return null;
  const parts = (first as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  const chunks: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      chunks.push((part as { text: string }).text);
    }
  }
  const text = chunks.join("").trim();
  return text || null;
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseDataUrl(dataUrl: string): { mime: string; data: string } {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) throw new Error("Bottle photo is not a data URL");
  return { mime: match[1], data: match[2] };
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sku: { type: "STRING", nullable: true },
    label: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["label", "confidence"],
};

export async function identifyEmptyBottle(input: {
  imageDataUrl: string;
  catalog: EmptyBottleCatalogItem[];
  captionHint: string;
  env: EmptyBottleIdentifyEnv;
  fetchImpl: typeof fetch;
}): Promise<EmptyBottleProposal> {
  const apiKey = input.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("identify_unavailable");
  }
  const image = parseDataUrl(input.imageDataUrl);
  const model = input.env.GEMINI_MODEL?.trim() || GEMINI_FLASH_MODEL;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const catalog = input.catalog.map((item) => ({ sku: item.sku, name: item.name }));
  const response = await input.fetchImpl(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "You identify empty liquor bottles for Berrify inventory. Never call tools. Never use Google Search. Reply with JSON only.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Identify the empty bottle. Prefer a catalog SKU when the photo matches.",
                `Catalog: ${JSON.stringify(catalog)}`,
                `Caption hint: ${input.captionHint || "(none)"}`,
                'Return { "sku": catalog SKU or null, "label": short generic name, "confidence": 0-1 }.',
              ].join("\n"),
            },
            { inline_data: { mime_type: image.mime, data: image.data } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? (payload as { error?: { message?: string } }).error?.message
        : undefined;
    throw new Error(message?.trim() || "Gemini identify failed");
  }

  const text = extractGeminiJsonText(payload);
  if (!text) throw new Error("Gemini returned no bottle");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Gemini returned invalid bottle JSON");
  }
  const proposal = parseEmptyBottleIdentify(parsedJson);
  if (!proposal) throw new Error("Gemini returned no bottle");
  return proposal;
}
