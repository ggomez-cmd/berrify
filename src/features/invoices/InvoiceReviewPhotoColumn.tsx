import type { ReactNode } from "react";

export function InvoiceReviewPhotoColumn({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0" data-testid="invoice-review-photo-column">
      {children}
    </div>
  );
}
