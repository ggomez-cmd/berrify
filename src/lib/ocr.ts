import { createWorker } from "tesseract.js";

export type OcrResult = {
  text: string;
  confidence: number;
  rotation: number;
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
  if (/ballester|supermax|jose\s+santiago|can enterprise/i.test(text)) score += 40;
  if (/factura|subtotal|balance due|desp/i.test(text)) score += 15;
  if (/\d+\.\d{2}/.test(text)) score += 5;
  return score;
}

export async function ocrImage(image: string): Promise<OcrResult> {
  const worker = await createWorker("eng");
  try {
    let best: OcrResult = { text: "", confidence: -1, rotation: 0 };
    let bestScore = -1;
    for (const rotation of ROTATIONS) {
      const src = await rotateImage(image, rotation);
      const { data } = await worker.recognize(src);
      const text = data.text ?? "";
      const confidence = data.confidence ?? 0;
      const score = usefulness(text, confidence);
      if (score > bestScore) {
        bestScore = score;
        best = { text, confidence, rotation };
      }
    }
    return best;
  } finally {
    await worker.terminate();
  }
}
