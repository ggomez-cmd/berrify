import { Camera, FileText, FileUp, MessageCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { InvoiceSource } from "../../lib/types";

export const INVOICE_PHOTO_ACCEPT = "image/*";
export const INVOICE_PDF_ACCEPT = "application/pdf,.pdf";

export function InvoiceCaptureButtons({
  busy,
  onFile,
}: {
  busy: boolean;
  onFile: (file: File, source: InvoiceSource, caption?: string) => void;
}) {
  return (
    <>
      <label className="inline-flex">
        <input
          className="hidden"
          type="file"
          accept={INVOICE_PHOTO_ACCEPT}
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file, "camera");
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
        >
          <Camera className="size-4" />
          Camera
        </Button>
      </label>
      <label className="inline-flex">
        <input
          className="hidden"
          type="file"
          accept={INVOICE_PHOTO_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file, "upload");
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
        >
          <FileUp className="size-4" />
          Upload photo
        </Button>
      </label>
      <label className="inline-flex">
        <input
          className="hidden"
          type="file"
          accept={INVOICE_PDF_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file, "upload");
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
        >
          <FileText className="size-4" />
          Upload PDF
        </Button>
      </label>
      <label className="inline-flex">
        <input
          className="hidden"
          type="file"
          accept={INVOICE_PHOTO_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file, "whatsapp", "Forwarded from WhatsApp kitchen group");
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
        >
          <MessageCircle className="size-4" />
          WhatsApp
        </Button>
      </label>
    </>
  );
}
