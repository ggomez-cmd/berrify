import { describe, expect, it } from "vitest";
import { isValidClockPin, normalizeClockPin, pinError } from "./pin";

describe("isValidClockPin", () => {
  it("accepts 4 to 8 digits", () => {
    expect(isValidClockPin("2580")).toBe(true);
    expect(isValidClockPin("14702580")).toBe(true);
  });

  it("rejects short, long, or non-digit values", () => {
    expect(isValidClockPin("123")).toBe(false);
    expect(isValidClockPin("123456789")).toBe(false);
    expect(isValidClockPin("12ab")).toBe(false);
    expect(isValidClockPin("")).toBe(false);
  });
});

describe("normalizeClockPin", () => {
  it("strips non-digits and caps at 8", () => {
    expect(normalizeClockPin("12-34")).toBe("1234");
    expect(normalizeClockPin("1234567890")).toBe("12345678");
  });
});

describe("pinError", () => {
  it("explains empty and invalid pins", () => {
    expect(pinError("")).toBe("Enter a PIN");
    expect(pinError("12")).toBe("PIN must be 4 to 8 digits");
    expect(pinError("2580")).toBeNull();
  });
});
