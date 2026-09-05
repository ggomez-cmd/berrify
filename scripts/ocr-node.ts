import sharp from "sharp";
import { createWorker } from "tesseract.js";

export type NodeOcrResult = {
  text: string;
  confidence: number;
  rotation: number;
};

const ROTATIONS = [0, 90, 180, 270] as const;

export async function ocrFile(filePath: string): Promise<NodeOcrResult> {
  const worker = await createWorker("eng");
  try {
    let best: NodeOcrResult = { text: "", confidence: -1, rotation: 0 };
    for (const rotation of ROTATIONS) {
      const buf = await sharp(filePath)
        .rotate()
        .rotate(rotation)
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: false })
        .jpeg({ quality: 90 })
        .toBuffer();
      const { data } = await worker.recognize(buf);
      const confidence = data.confidence ?? 0;
      if (confidence > best.confidence) {
        best = { text: data.text ?? "", confidence, rotation };
      }
    }
    return best;
  } finally {
    await worker.terminate();
  }
}
