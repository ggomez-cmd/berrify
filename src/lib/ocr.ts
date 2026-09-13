import { createWorker } from "tesseract.js";
import { supabase } from "./supabase";

export type OcrEngine = "vision" | "tesseract";

export type OcrResult = {
  text: string;
  confidence: number;
  rotation: number;
  engine: OcrEngine;
};

export type OcrImageOptions = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  fallback?: (image: string) => Promise<OcrResult>;
};

const ROTATIONS = [0, 90, 180, 270] as const;

export async function rotateImage(dataUrl: string, degrees: number): Promise<string> {
  if (degrees === 0) return dataUrl;
  if (typeof document === "undefined") return dataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const swap = degrees % 180 !== 0;
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create canvas context"));
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Could not load invoice image"));
    img.src = dataUrl;
  });
}

function usefulness(text: string, confidence: number): number {
  let score = confidence;
  if (
    /ballester|supermax|jose\s+santiago|drouyn|santurce|fern[aá]ndez|northwestern|selecta|can enterprise/i.test(
      text,
    )
  ) {
    score += 40;
  }
  if (/factura|subtotal|balance due|desp/i.test(text)) score += 15;
  if (/\d+\.\d{2}/.test(text)) score += 5;
  return score;
}

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function ocrImageWithTesseract(image: string): Promise<OcrResult> {
  const worker = await createWorker("eng");
  try {
    let best: OcrResult = { text: "", confidence: -1, rotation: 0, engine: "tesseract" };
    let bestScore = -1;
    for (const rotation of ROTATIONS) {
      const src = await rotateImage(image, rotation);
      const { data } = await worker.recognize(src);
      const text = data.text ?? "";
      const confidence = data.confidence ?? 0;
      const score = usefulness(text, confidence);
      if (score > bestScore) {
        bestScore = score;
        best = { text, confidence, rotation, engine: "tesseract" };
      }
    }
    return best;
  } finally {
    await worker.terminate();
  }
}

async function ocrImageWithVision(
  image: string,
  options: OcrImageOptions,
): Promise<OcrResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAccessToken = options.getAccessToken ?? defaultAccessToken;
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl("/api/ocr", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ image }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    const text = (body as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) return null;
    const rawConfidence = (body as { confidence?: unknown }).confidence;
    const confidence = typeof rawConfidence === "number" ? rawConfidence : 100;
    return { text, confidence, rotation: 0, engine: "vision" };
  } catch {
    return null;
  }
}

export async function ocrImage(image: string, options: OcrImageOptions = {}): Promise<OcrResult> {
  const vision = await ocrImageWithVision(image, options);
  if (vision) return vision;
  const fallback = options.fallback ?? ocrImageWithTesseract;
  return fallback(image);
}

export function ocrEngineNote(ocr: OcrResult): string {
  switch (ocr.engine) {
    case "vision":
      return "Vision OCR";
    case "tesseract":
      return `Tesseract OCR rotation ${ocr.rotation}°`;
    default: {
      const exhaustive: never = ocr.engine;
      return exhaustive;
    }
  }
}
