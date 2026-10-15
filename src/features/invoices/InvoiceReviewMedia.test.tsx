import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvoiceReviewMedia } from "./InvoiceReviewMedia";

describe("InvoiceReviewMedia", () => {
  it("renders a PDF object and download link instead of an image", () => {
    render(
      <InvoiceReviewMedia
        src="data:application/pdf;base64,JVBERi0="
        mime="application/pdf"
        lightboxOpen={false}
        onLightboxOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("invoice-review-pdf")).toBeInTheDocument();
    expect(screen.getAllByTitle("Invoice PDF").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "download",
      "invoice.pdf",
    );
    expect(screen.queryByRole("img", { name: "Invoice photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Click to zoom" })).not.toBeInTheDocument();
  });

  it("keeps the image lightbox trigger for raster photos", () => {
    render(
      <InvoiceReviewMedia
        src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        mime="image/gif"
        lightboxOpen={false}
        onLightboxOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Invoice photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Click to zoom" })).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-review-pdf")).not.toBeInTheDocument();
  });
});
