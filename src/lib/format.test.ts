import { describe, expect, it } from "vitest";
import { initials } from "./format";

describe("initials", () => {
  it("uses the first letters of the first two names", () => {
    expect(initials("Sofia Reyes")).toBe("SR");
  });

  it("uses two letters from a single name", () => {
    expect(initials("Pacifico")).toBe("PA");
  });

  it("returns a placeholder for blank input", () => {
    expect(initials("   ")).toBe("?");
  });
});
