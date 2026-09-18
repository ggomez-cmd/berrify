import {
  parseEmptyBottleIdentifyLines,
  shouldRetryEmptyBottleGemini,
  type EmptyBottleCatalogItem,
  type EmptyBottleIdentifyResult,
} from "../src/lib/empty-bottle";
import { filterVisionBottleObjects, parseVisionAnnotateResponse } from "../src/lib/empty-bottle-vision";
import { GEMINI_FLASH_MODEL } from "./invoice-extract-post";

export type EmptyBottleIdentifyEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GOOGLE_VISION_API_KEY?: string;
};

export type EmptyBottleIdentifyOutput = {
  visionCount: number | null;
  geminiCount: number;
  lines: EmptyBottleIdentifyResult["lines"];
  ocrHints: string;
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
    bottle_count: { type: "INTEGER" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          label: { type: "STRING" },
          sku: { type: "STRING", nullable: true },
          qty: { type: "NUMBER" },
        },
        required: ["index", "label", "qty"],
      },
    },
  },
  required: ["bottle_count", "lines"],
};

const SYSTEM_PROMPT =
  "You identify empty liquor bottles for Berrify inventory. Never call tools. Never use Google Search. Reply with JSON only.";

function userPrompt(input: {
  catalog: Array<{ sku: string; name: string }>;
  captionHint: string;
  visionCount: number | null;
  ocrHints: string;
  retryExact: number | null;
}): string {
  const visionLine =
    input.visionCount == null
      ? "Vision box count is unavailable. Count every standing glass bottle yourself."
      : `Vision found ${input.visionCount} bottle boxes.`;
  const retry =
    input.retryExact == null
      ? ""
      : `\nReturn exactly ${input.retryExact} lines — one per physical bottle, left to right.`;
  return [
    "Count every standing glass bottle in the photo first.",
    "Every standing glass bottle is a line. Walk left to right.",
    "Use qty: 1 per physical bottle. Do not merge duplicates into one line.",
    "Unlabeled wine or liquor is still a line.",
    "Ignore cartons, boxes, and packaging.",
    "bottle_count must equal lines.length.",
    "Prefer catalog SKUs (BV-EB-*).",
    visionLine,
    `OCR hints (labels only, may miss unlabeled bottles): ${input.ocrHints || "(none)"}`,
    `Catalog: ${JSON.stringify(input.catalog)}`,
    `Caption hint: ${input.captionHint || "(none)"}`,
    'Return { "bottle_count": N, "lines": [{ "index": 1, "label": "short name", "sku": catalog SKU or null, "qty": 1 }] }.',
    retry,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callGemini(input: {
  apiKey: string;
  model: string;
  image: { mime: string; data: string };
  catalog: Array<{ sku: string; name: string }>;
  captionHint: string;
  visionCount: number | null;
  ocrHints: string;
  retryExact: number | null;
  fetchImpl: typeof fetch;
}): Promise<EmptyBottleIdentifyResult> {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const response = await input.fetchImpl(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: userPrompt({
                catalog: input.catalog,
                captionHint: input.captionHint,
                visionCount: input.visionCount,
                ocrHints: input.ocrHints,
                retryExact: input.retryExact,
              }),
            },
            { inline_data: { mime_type: input.image.mime, data: input.image.data } },
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
  if (!text) throw new Error("Gemini returned no bottles");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("Gemini returned invalid bottle JSON");
  }
  const parsed = parseEmptyBottleIdentifyLines(parsedJson);
  if (!parsed) throw new Error("Gemini returned no bottles");
  return parsed;
}

async function annotateVision(input: {
  apiKey: string;
  imageContent: string;
  fetchImpl: typeof fetch;
}): Promise<{ visionCount: number; ocrHints: string } | null> {
  const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(input.apiKey)}`;
  try {
    const response = await input.fetchImpl(visionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: input.imageContent },
            features: [{ type: "OBJECT_LOCALIZATION" }, { type: "TEXT_DETECTION" }],
            imageContext: { languageHints: ["es", "en"] },
          },
        ],
      }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      console.warn("empty-bottle identify: Vision returned invalid JSON; continuing with Gemini");
      return null;
    }
    if (!response.ok) {
      console.warn("empty-bottle identify: Vision annotate failed; continuing with Gemini");
      return null;
    }
    const parsed = parseVisionAnnotateResponse(payload);
    const boxes = filterVisionBottleObjects(parsed.objects);
    return { visionCount: boxes.length, ocrHints: parsed.ocrText.slice(0, 1500) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Vision failed";
    console.warn(`empty-bottle identify: Vision skipped (${detail}); continuing with Gemini`);
    return null;
  }
}

export async function identifyEmptyBottle(input: {
  imageDataUrl: string;
  catalog: EmptyBottleCatalogItem[];
  captionHint: string;
  env: EmptyBottleIdentifyEnv;
  fetchImpl: typeof fetch;
}): Promise<EmptyBottleIdentifyOutput> {
  const apiKey = input.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("identify_unavailable");
  }
  const image = parseDataUrl(input.imageDataUrl);
  const model = input.env.GEMINI_MODEL?.trim() || GEMINI_FLASH_MODEL;
  const catalog = input.catalog.map((item) => ({ sku: item.sku, name: item.name }));

  let visionCount: number | null = null;
  let ocrHints = "";
  const visionKey = input.env.GOOGLE_VISION_API_KEY?.trim();
  if (!visionKey) {
    console.warn("empty-bottle identify: Vision skipped (no GOOGLE_VISION_API_KEY); continuing with Gemini");
  } else {
    const vision = await annotateVision({
      apiKey: visionKey,
      imageContent: image.data,
      fetchImpl: input.fetchImpl,
    });
    if (vision) {
      visionCount = vision.visionCount;
      ocrHints = vision.ocrHints;
    }
  }

  let result = await callGemini({
    apiKey,
    model,
    image,
    catalog,
    captionHint: input.captionHint,
    visionCount,
    ocrHints,
    retryExact: null,
    fetchImpl: input.fetchImpl,
  });

  if (shouldRetryEmptyBottleGemini(result, visionCount)) {
    const exact = visionCount != null && visionCount >= 1 ? visionCount : result.bottle_count;
    result = await callGemini({
      apiKey,
      model,
      image,
      catalog,
      captionHint: input.captionHint,
      visionCount,
      ocrHints,
      retryExact: exact,
      fetchImpl: input.fetchImpl,
    });
  }

  return {
    visionCount,
    geminiCount: result.lines.length,
    lines: result.lines,
    ocrHints,
  };
}
