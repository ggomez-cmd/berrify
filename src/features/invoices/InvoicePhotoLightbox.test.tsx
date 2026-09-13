import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { InvoicePhotoLightbox } from "./InvoicePhotoLightbox";

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <InvoicePhotoLightbox
      open={open}
      src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
      onClose={() => setOpen(false)}
    />
  );
}

describe("InvoicePhotoLightbox", () => {
  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <InvoicePhotoLightbox
        open
        src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close photo overlay" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and resets zoom after close", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Invoice photo" })).not.toBeInTheDocument();
  });
});
