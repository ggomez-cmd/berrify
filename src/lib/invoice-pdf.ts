import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { decodeDataUrlPayload, isPdfBytes, MAX_INVOICE_IMAGE_BYTES } from "./invoice-image";

export const EMPTY_PDF_TEXT_ERROR =
  "Could not read text from this PDF. Use a text-based PDF, or upload a photo of the invoice.";

export type PdfGetDocument = typeof getDocument;

let workerConfigured = false;

function configurePdfWorker(): void {
  if (workerConfigured) return;
  GlobalWorkerOptions.workerSrc = pdfjsWorker;
  workerConfigured = true;
}

export function requirePdfText(text: string): string {
  const trimmed = text.split("\u0000").join("").trim();
  if (!trimmed) {
    throw new Error(EMPTY_PDF_TEXT_ERROR);
  }
  return trimmed;
}

type PdfTextItem = { str?: unknown; hasEOL?: unknown };

/** Line-anchored receipt parsers need pdf.js's visual line breaks (`hasEOL`). */
function textFromContentItems(items: PdfTextItem[]): string {
  return items
    .map((item) => `${typeof item.str === "string" ? item.str : ""}${item.hasEOL === true ? "\n" : " "}`)
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function textFromPdfDocument(pdf: PDFDocumentProxy): Promise<string> {
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = textFromContentItems(content.items as PdfTextItem[]);
    if (pageText) pages.push(pageText);
  }
  return pages.join("\n\n");
}

export async function extractPdfText(
  bytes: Uint8Array,
  options: {
    getDocumentImpl?: PdfGetDocument;
  } = {},
): Promise<string> {
  if (bytes.byteLength > MAX_INVOICE_IMAGE_BYTES) {
    throw new Error("Invoice file must be 8 MB or smaller.");
  }
  if (!isPdfBytes(bytes)) {
    throw new Error("Invoice must be a PDF or raster image file.");
  }

  configurePdfWorker();

  const getDocumentImpl = options.getDocumentImpl ?? getDocument;
  const loadingTask = getDocumentImpl({
    data: bytes.slice(),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  try {
    return requirePdfText(await textFromPdfDocument(pdf));
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfTextFromDataUrl(
  dataUrl: string,
  options?: {
    getDocumentImpl?: PdfGetDocument;
  },
): Promise<string> {
  const { bytes } = decodeDataUrlPayload(dataUrl);
  return extractPdfText(bytes, options);
}
