export const MAX_INVOICE_IMAGE_BYTES = 8 * 1024 * 1024;

export function assertInvoiceImage(file: File): void {
  if (file.size > MAX_INVOICE_IMAGE_BYTES) {
    throw new Error("Invoice photo must be 8 MB or smaller.");
  }
  const mime = file.type.toLowerCase();
  if (mime === "image/svg+xml" || (mime && !mime.startsWith("image/"))) {
    throw new Error("Invoice must be a raster image file.");
  }
}
