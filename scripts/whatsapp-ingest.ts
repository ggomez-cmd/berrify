/**
 * WhatsApp Business inbox → same invoice pipeline as the Invoices page.
 *
 * Official WhatsApp Cloud API cannot join a normal kitchen group. Staff
 * photograph the bill in the group, then forward it to the restaurant Business
 * number (or upload the photo in Berrify). This script is the offline / file
 * path for that forwarded image.
 *
 * Usage:
 *   npm run whatsapp:ingest -- --file ./bill.jpg --from +17875550100
 *   npm run whatsapp:ingest -- --file ./ocr.txt --caption "Forwarded factura"
 *
 * Cloud API webhook shape (document only — no live webhook in this MVP):
 *
 * POST /webhooks/whatsapp
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "changes": [{
 *       "value": {
 *         "messages": [{
 *           "from": "17875550100",
 *           "id": "wamid.HBgL...",
 *           "type": "image",
 *           "image": { "id": "MEDIA_ID", "caption": "Factura Jose Santiago" }
 *         }]
 *       }
 *     }]
 *   }]
 * }
 *
 * Download the media with the Cloud API, then pass the file to this script
 * (or the Invoices UI). Group-chat bots are out of scope.
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  ACCOUNTS,
  DEFAULT_ACCOUNT_RULES,
  extractInvoiceFromText,
  type VendorAlias,
} from "../src/lib/invoice-extract.ts";
import { ocrFile } from "./ocr-node.ts";

dotenv.config();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const filePath = arg("file");
if (!filePath) {
  throw new Error("Usage: npm run whatsapp:ingest -- --file <photo-or-ocr.txt> [--caption ...] [--from ...] [--org-id ...]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const abs = resolve(filePath);
const ext = extname(abs).toLowerCase();
const caption = arg("caption") ?? "Forwarded from WhatsApp Business inbox";
const from = arg("from") ?? null;
const messageId = arg("message-id") ?? null;
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

let ocrText = imageExts.has(ext) ? "" : readFileSync(abs, "utf8");
if (imageExts.has(ext)) {
  console.error(`OCR ${abs} (trying 0/90/180/270)…`);
  const ocr = await ocrFile(abs);
  ocrText = ocr.text || caption;
  console.error(`OCR rotation ${ocr.rotation}° confidence ${ocr.confidence.toFixed(1)}`);
}
if (!ocrText.trim()) ocrText = caption;
const imageData = imageExts.has(ext)
  ? `data:image/${ext.replace(".", "") === "jpg" ? "jpeg" : ext.replace(".", "")};base64,${readFileSync(abs).toString("base64")}`
  : null;

const { data: orgRow, error: orgError } = arg("org-id")
  ? { data: { id: arg("org-id") }, error: null }
  : await admin.from("organizations").select("id").order("created_at").limit(1).maybeSingle();
if (orgError || !orgRow) throw orgError ?? new Error("No organization found. Pass --org-id.");

const orgId = orgRow.id as string;
const { data: aliasRows, error: aliasError } = await admin
  .from("vendor_aliases")
  .select("match_text, supplier_id, qbo_vendor_name")
  .eq("org_id", orgId);
if (aliasError) throw aliasError;
const { data: ruleRows, error: ruleError } = await admin
  .from("account_rules")
  .select("keyword, account, memo, category")
  .eq("org_id", orgId);
if (ruleError) throw ruleError;

const aliases = (aliasRows ?? []) as VendorAlias[];
const rules = (ruleRows ?? []).length > 0 ? ruleRows! : DEFAULT_ACCOUNT_RULES;
const extracted = extractInvoiceFromText(ocrText, aliases, rules);

const { data: invoice, error: invError } = await admin
  .from("invoices")
  .insert({
    org_id: orgId,
    supplier_id: extracted.supplier_id,
    vendor_name: extracted.vendor_name,
    invoice_number: extracted.invoice_number,
    invoice_date: extracted.invoice_date,
    due_date: extracted.due_date,
    terms: extracted.terms,
    subtotal: extracted.subtotal,
    tax: extracted.tax,
    total: extracted.total,
    ap_account: ACCOUNTS.ap,
    status: extracted.lines.length > 0 || extracted.total > 0 ? "extracted" : "received",
    source: "whatsapp",
    whatsapp_from: from,
    whatsapp_message_id: messageId,
    caption,
    image_data: imageData,
    image_mime: imageData ? "image/jpeg" : null,
    ocr_text: ocrText,
  })
  .select("id, invoice_number, total")
  .single();
if (invError || !invoice) throw invError ?? new Error("Failed to insert invoice");

if (extracted.lines.length > 0) {
  const { error } = await admin.from("invoice_lines").insert(
    extracted.lines.map((line) => ({
      org_id: orgId,
      invoice_id: invoice.id,
      ...line,
    })),
  );
  if (error) throw error;
}
if (extracted.expenses.length > 0) {
  const { error } = await admin.from("invoice_expense_lines").insert(
    extracted.expenses.map((line, index) => ({
      org_id: orgId,
      invoice_id: invoice.id,
      account: line.account,
      amount: line.amount,
      memo: line.memo,
      sort_order: index,
    })),
  );
  if (error) throw error;
}

console.log(
  JSON.stringify(
    {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      total: invoice.total,
      vendor: extracted.qbo_vendor_name,
      expenses: extracted.expenses,
    },
    null,
    2,
  ),
);
