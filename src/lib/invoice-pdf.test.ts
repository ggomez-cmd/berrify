import { describe, expect, it } from "vitest";
import {
  EMPTY_PDF_TEXT_ERROR,
  extractPdfText,
  extractPdfTextFromDataUrl,
  requirePdfText,
  type PdfGetDocument,
} from "./invoice-pdf";

function makeTextPdf(text: string): Uint8Array {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 20 100 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefStart = body.length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function mockGetDocument(items: Array<{ str?: string }>): PdfGetDocument {
  return (() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items }),
      }),
      destroy: async () => undefined,
    }),
  })) as unknown as PdfGetDocument;
}

describe("requirePdfText", () => {
  it("rejects blank extraction so ingest cannot create an empty bill", () => {
    expect(() => requirePdfText("   \n")).toThrow(EMPTY_PDF_TEXT_ERROR);
    expect(requirePdfText("  Sam's Club  ")).toBe("Sam's Club");
  });
});

describe("extractPdfText", () => {
  it("rejects non-PDF bytes before calling pdf.js", async () => {
    await expect(extractPdfText(new TextEncoder().encode("not a pdf"))).rejects.toThrow(
      /PDF or raster image/,
    );
  });

  it("joins page text from pdf.js", async () => {
    const bytes = makeTextPdf("ignored");
    await expect(
      extractPdfText(bytes, {
        getDocumentImpl: mockGetDocument([{ str: "Sam's Club" }, { str: "Total 12.00" }]),
      }),
    ).resolves.toBe("Sam's Club Total 12.00");
  });

  it("errors when pdf.js returns no selectable text", async () => {
    await expect(
      extractPdfText(makeTextPdf("ignored"), {
        getDocumentImpl: mockGetDocument([]),
      }),
    ).rejects.toThrow(EMPTY_PDF_TEXT_ERROR);
  });

  it("reads a PDF data URL through the helper", async () => {
    const bytes = makeTextPdf("unused");
    const dataUrl = `data:application/pdf;base64,${btoa(String.fromCharCode(...bytes))}`;
    await expect(
      extractPdfTextFromDataUrl(dataUrl, {
        getDocumentImpl: mockGetDocument([{ str: "Hello PDF" }]),
      }),
    ).resolves.toBe("Hello PDF");
  });
});
