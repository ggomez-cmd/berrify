import {
  isPageAttachCaption,
  sameInvoiceRef,
  shouldAttachInvoicePage,
  telegramChatIdFromMessageId,
  withinPageAttachWindow,
} from "./invoice-pages";

export type TelegramAttachInvoice = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  created_at: string;
  telegram_message_id: string | null;
  telegram_media_group_id: string | null;
};

export function pickTelegramAttachCandidate(input: {
  mediaGroupId: string | null;
  caption: string | null;
  chatId: string;
  invoices: TelegramAttachInvoice[];
  incomingVendorFullName?: string | null;
  nowMs?: number;
}): TelegramAttachInvoice | null {
  const nowMs = input.nowMs ?? Date.now();
  const pageCaption = isPageAttachCaption(input.caption);
  const captionRef = input.caption?.match(/\b(?:inv(?:oice)?\s*#?|factura\s*#?|ref(?:erence)?\s*#?)?\s*([A-Z0-9-]{4,})\b/i)?.[1] ?? null;

  const album = input.mediaGroupId
    ? input.invoices.find((row) => row.telegram_media_group_id === input.mediaGroupId)
    : undefined;
  if (album) {
    if (
      shouldAttachInvoicePage({
        sameMediaGroup: true,
        pageCaption,
        sameInvoiceNumber: sameInvoiceRef(captionRef, album.invoice_number),
        withinWindow: true,
        incomingVendorFullName: input.incomingVendorFullName,
        existingVendorFullName: album.vendor_name,
      })
    ) {
      return album;
    }
    return null;
  }

  const recent = input.invoices.find((row) => {
    const chatId = telegramChatIdFromMessageId(row.telegram_message_id);
    if (chatId !== input.chatId) return false;
    return withinPageAttachWindow(row.created_at, nowMs);
  });
  if (!recent) return null;
  if (
    shouldAttachInvoicePage({
      sameMediaGroup: false,
      pageCaption,
      sameInvoiceNumber: sameInvoiceRef(captionRef ?? input.caption, recent.invoice_number),
      withinWindow: true,
      incomingVendorFullName: input.incomingVendorFullName,
      existingVendorFullName: recent.vendor_name,
    })
  ) {
    return recent;
  }
  return null;
}
