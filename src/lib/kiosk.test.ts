import { describe, expect, it } from "vitest";
import { KIOSK_CONFIRM_MS, KIOSK_IDLE_MS, shouldPromptKioskExit } from "./kiosk";

describe("kiosk lock timing", () => {
  it("returns to the PIN pad after a short confirm and idle window", () => {
    expect(KIOSK_CONFIRM_MS).toBe(1600);
    expect(KIOSK_IDLE_MS).toBe(20_000);
  });
});

describe("shouldPromptKioskExit", () => {
  it("prompts unless the org has no owner PIN configured", () => {
    expect(shouldPromptKioskExit(true)).toBe(true);
    expect(shouldPromptKioskExit(undefined)).toBe(true);
    expect(shouldPromptKioskExit(false)).toBe(false);
  });
});
