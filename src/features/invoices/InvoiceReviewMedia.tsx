import { InvoicePhotoLightbox } from "./InvoicePhotoLightbox";
import { isPdfAttachment } from "../../lib/invoice-image";

export function InvoiceReviewMedia({
  src,
  mime,
  lightboxOpen,
  onLightboxOpenChange,
  pageLabel,
  onPrevPage,
  onNextPage,
}: {
  src: string;
  mime?: string | null;
  lightboxOpen: boolean;
  onLightboxOpenChange: (open: boolean) => void;
  pageLabel?: string | null;
  onPrevPage?: () => void;
  onNextPage?: () => void;
}) {
  if (isPdfAttachment(src, mime)) {
    return (
      <div className="grid gap-2" data-testid="invoice-review-pdf">
        <object
          data={src}
          type="application/pdf"
          title="Invoice PDF"
          className="h-80 w-full rounded-xl border border-line bg-paper"
        >
          <iframe title="Invoice PDF" src={src} className="h-80 w-full rounded-xl border-0" />
        </object>
        <a
          href={src}
          download="invoice.pdf"
          className="text-sm text-navy underline underline-offset-2"
        >
          Download PDF
        </a>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="relative w-full cursor-pointer rounded-xl text-left"
        aria-label="Click to zoom"
        onClick={() => onLightboxOpenChange(true)}
      >
        <img
          src={src}
          alt="Invoice photo"
          className="pointer-events-none max-h-80 w-full rounded-xl border border-line bg-paper object-contain"
        />
        <span className="absolute bottom-2 left-2 rounded-lg bg-navy/70 px-2 py-1 text-xs text-white">
          Click to zoom
        </span>
      </button>
      <InvoicePhotoLightbox
        open={lightboxOpen}
        src={src}
        onClose={() => onLightboxOpenChange(false)}
        pageLabel={pageLabel}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
      />
    </>
  );
}
