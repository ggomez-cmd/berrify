import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  INVOICE_PDF_ACCEPT,
  INVOICE_PHOTO_ACCEPT,
  InvoiceCaptureButtons,
} from "./InvoiceCaptureButtons";

describe("InvoiceCaptureButtons", () => {
  it("keeps photo inputs on image/* and adds a PDF upload control", () => {
    render(<InvoiceCaptureButtons busy={false} onFile={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Camera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WhatsApp" })).toBeInTheDocument();

    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(4);
    expect(inputs[0]).toHaveAttribute("accept", INVOICE_PHOTO_ACCEPT);
    expect(inputs[1]).toHaveAttribute("accept", INVOICE_PHOTO_ACCEPT);
    expect(inputs[2]).toHaveAttribute("accept", INVOICE_PDF_ACCEPT);
    expect(inputs[3]).toHaveAttribute("accept", INVOICE_PHOTO_ACCEPT);
    expect(INVOICE_PDF_ACCEPT).toMatch(/application\/pdf/);
  });
});
