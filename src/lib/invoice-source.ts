import type { InvoiceSource } from "./types";

export function invoiceSourceLabel(source: InvoiceSource): string {
  switch (source) {
    case "upload":
      return "Upload";
    case "whatsapp":
      return "WhatsApp";
    case "camera":
      return "Camera";
    case "telegram":
      return "Telegram";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}
