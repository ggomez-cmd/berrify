const THIN_OCR_CHARS = 80;
const THIN_OCR_DIGITS = 6;
const THIN_OCR_CONFIDENCE = 40;

/** Vision text is too sparse to extract without optionally sending the photo. */
export function isThinOcrText(text: string, confidence?: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length < THIN_OCR_CHARS) return true;
  if (typeof confidence === "number" && confidence < THIN_OCR_CONFIDENCE) return true;
  const digits = (trimmed.match(/\d/g) ?? []).length;
  return digits < THIN_OCR_DIGITS;
}
