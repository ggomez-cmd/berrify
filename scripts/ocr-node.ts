import sharp from "sharp";
import { createWorker } from "tesseract.js";

export type NodeOcrResult = {
  text: string;
  confidence: number;
  rotation: number;
};

const ROTATIONS = [0, 90, 180, 270] as const;

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

export async function ocrFile(filePath: string): Promise<NodeOcrResult> {
  const worker = await createWorker("eng");
  try {
    let best: NodeOcrResult = { text: "", confidence: -1, rotation: 0 };
    let bestScore = -1;
    for (const rotation of ROTATIONS) {
      const buf = await sharp(filePath)
        .rotate()
        .rotate(rotation)
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
      const { data } = await worker.recognize(buf);
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
