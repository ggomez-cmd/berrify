import type { ExtractedInvoice } from "./invoice-extract";
import { differentVendorFullName } from "./qb-vendor-match";

export const INVOICE_PAGE_ATTACH_WINDOW_MS = 2 * 60 * 60 * 1000;

export type InvoicePageImage = {
  sort_order: number;
  image_data: string | null;
  image_mime: string | null;
};

export function invoicesToPersistFromPhoto(extracted: ExtractedInvoice[]): ExtractedInvoice[] {
  return extracted.slice(0, 1);
}

export function isPageAttachCaption(caption: string | null | undefined): boolean {
  if (!caption) return false;
  return /\b(?:page|p\.?)\s*0*2\b/i.test(caption);
}

export function sameInvoiceRef(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): boolean {
  const a = incoming?.replace(/\s+/g, "").toLowerCase() ?? "";
  const b = existing?.replace(/\s+/g, "").toLowerCase() ?? "";
  return a.length >= 4 && a === b;
}

export function withinPageAttachWindow(existingCreatedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!existingCreatedAt) return false;
  const created = Date.parse(existingCreatedAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created >= 0 && nowMs - created <= INVOICE_PAGE_ATTACH_WINDOW_MS;
}

export function shouldAttachInvoicePage(input: {
  sameMediaGroup: boolean;
  pageCaption: boolean;
  sameInvoiceNumber: boolean;
  withinWindow: boolean;
  incomingVendorFullName?: string | null;
  existingVendorFullName?: string | null;
}): boolean {
  if (differentVendorFullName(input.incomingVendorFullName, input.existingVendorFullName)) {
    return false;
  }
  if (input.sameMediaGroup) return true;
  if (input.withinWindow && (input.pageCaption || input.sameInvoiceNumber)) return true;
  return false;
}

export function composeInvoicePageImages(
  first: { image_data: string | null; image_mime: string | null } | null | undefined,
  extra: InvoicePageImage[],
): InvoicePageImage[] {
  const extras = [...extra].sort((a, b) => a.sort_order - b.sort_order);
  const pages: InvoicePageImage[] = [];
  if (first?.image_data) {
    pages.push({ sort_order: 0, image_data: first.image_data, image_mime: first.image_mime });
  }
  for (const page of extras) {
    if (page.sort_order === 0 && pages.some((row) => row.sort_order === 0)) continue;
    pages.push(page);
  }
  return pages.sort((a, b) => a.sort_order - b.sort_order);
}

export function nextInvoicePageSortOrder(existing: Array<{ sort_order: number }>): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((row) => row.sort_order), 0) + 1;
}

export function joinPageOcrText(pages: Array<string | null | undefined>): string {
  return pages
    .map((text) => text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function telegramChatIdFromMessageId(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  const split = messageId.lastIndexOf(":");
  if (split <= 0) return null;
  return messageId.slice(0, split);
}
