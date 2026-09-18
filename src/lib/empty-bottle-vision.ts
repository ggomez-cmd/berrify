export type VisionNormalizedVertex = {
  x?: number;
  y?: number;
};

export type VisionLocalizedObject = {
  name?: string;
  score?: number;
  boundingPoly?: { normalizedVertices?: VisionNormalizedVertex[] };
};

export type VisionBottleBox = {
  name: string;
  score: number;
  x: number;
  area: number;
};

const BOTTLE_NAME = /^(wine bottle|beer bottle|liquor bottle|bottle)$/i;
const NOISE_NAME = /carton|cardboard|box|packaging|container/i;
const MIN_SCORE = 0.4;
const MIN_AREA = 0.008;
const DUP_IOU = 0.65;

function boxFromVertices(vertices: VisionNormalizedVertex[] | undefined): {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
} | null {
  if (!vertices || vertices.length < 2) return null;
  const xs = vertices.map((v) => (typeof v.x === "number" ? v.x : 0));
  const ys = vertices.map((v) => (typeof v.y === "number" ? v.y : 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  const area = w * h;
  if (area <= 0) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w, h, area };
}

function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const aLeft = a.x - a.w / 2;
  const aTop = a.y - a.h / 2;
  const bLeft = b.x - b.w / 2;
  const bTop = b.y - b.h / 2;
  const left = Math.max(aLeft, bLeft);
  const top = Math.max(aTop, bTop);
  const right = Math.min(aLeft + a.w, bLeft + b.w);
  const bottom = Math.min(aTop + a.h, bTop + b.h);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export function isBottleLikeObjectName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (NOISE_NAME.test(trimmed) && !BOTTLE_NAME.test(trimmed)) return false;
  return BOTTLE_NAME.test(trimmed);
}

export function filterVisionBottleObjects(objects: VisionLocalizedObject[]): VisionBottleBox[] {
  const candidates: Array<VisionBottleBox & { w: number; h: number; y: number }> = [];
  for (const object of objects) {
    const name = typeof object.name === "string" ? object.name.trim() : "";
    const score = typeof object.score === "number" ? object.score : 0;
    if (!isBottleLikeObjectName(name) || score < MIN_SCORE) continue;
    const box = boxFromVertices(object.boundingPoly?.normalizedVertices);
    if (!box || box.area < MIN_AREA) continue;
    candidates.push({ name, score, x: box.x, area: box.area, w: box.w, h: box.h, y: box.y });
  }

  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const duplicate = kept.some((existing) => iou(existing, candidate) >= DUP_IOU);
    if (duplicate) continue;
    kept.push(candidate);
  }

  return kept
    .sort((a, b) => a.x - b.x)
    .map(({ name, score, x, area }) => ({ name, score, x, area }));
}

export function parseVisionAnnotateResponse(payload: unknown): {
  objects: VisionLocalizedObject[];
  ocrText: string;
} {
  if (!payload || typeof payload !== "object") return { objects: [], ocrText: "" };
  const responses = (payload as { responses?: unknown }).responses;
  if (!Array.isArray(responses) || responses.length === 0) return { objects: [], ocrText: "" };
  const first = responses[0];
  if (!first || typeof first !== "object") return { objects: [], ocrText: "" };
  const row = first as {
    localizedObjectAnnotations?: VisionLocalizedObject[];
    fullTextAnnotation?: { text?: string };
    textAnnotations?: { description?: string }[];
  };
  const objects = Array.isArray(row.localizedObjectAnnotations) ? row.localizedObjectAnnotations : [];
  const ocrText =
    row.fullTextAnnotation?.text?.trim() ||
    row.textAnnotations?.[0]?.description?.trim() ||
    "";
  return { objects, ocrText };
}
