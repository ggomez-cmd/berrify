import { extractInvoicesFromText } from "../src/lib/invoice-extract.ts";
import { ocrFile } from "./ocr-node.ts";

const file = process.argv[2];
if (!file) throw new Error("Usage: npx tsx scripts/ocr-photo.ts <image>");

const ocr = await ocrFile(file);
console.log(JSON.stringify({ rotation: ocr.rotation, confidence: ocr.confidence }, null, 2));
console.log("---TEXT---");
console.log(ocr.text);
console.log("---EXTRACT---");
console.log(JSON.stringify(extractInvoicesFromText(ocr.text), null, 2));
