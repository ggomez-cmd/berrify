import { describe, expect, it } from "vitest";
import { toThrownError } from "./thrown-error";

describe("toThrownError", () => {
  it("keeps Error instances", () => {
    const err = new Error("already");
    expect(toThrownError(err, "fallback")).toBe(err);
  });

  it("wraps PostgREST-shaped objects", () => {
    const wrapped = toThrownError(
      { message: "Could not find the table 'public.invoice_extract_examples'", code: "PGRST205" },
      "Could not save invoice",
    );
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("Could not find the table 'public.invoice_extract_examples'");
  });

  it("uses fallback when message is missing", () => {
    expect(toThrownError({ code: "PGRST205" }, "Could not save invoice").message).toBe(
      "Could not save invoice",
    );
  });
});
