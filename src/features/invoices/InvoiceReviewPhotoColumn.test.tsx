import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InvoiceReviewPhotoColumn } from "./InvoiceReviewPhotoColumn";

describe("InvoiceReviewPhotoColumn", () => {
  it("keeps Add page in the photo column, not the restaurant column", () => {
    render(
      <div className="grid gap-4 lg:grid-cols-2">
        <InvoiceReviewPhotoColumn>
          <img alt="Invoice photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
          <button type="button">Add page</button>
        </InvoiceReviewPhotoColumn>
        <div>
          <label htmlFor="inv-rest">Restaurant / QBO books</label>
          <select id="inv-rest">
            <option>Kane</option>
          </select>
        </div>
      </div>,
    );

    const photoColumn = screen.getByTestId("invoice-review-photo-column");
    expect(photoColumn).toContainElement(screen.getByRole("img", { name: "Invoice photo" }));
    expect(photoColumn).toContainElement(screen.getByRole("button", { name: "Add page" }));
    expect(photoColumn).not.toHaveTextContent("Restaurant / QBO books");
    expect(photoColumn).toHaveClass("min-w-0");
  });
});
