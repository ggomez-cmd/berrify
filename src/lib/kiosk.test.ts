import { describe, expect, it } from "vitest";
import { KIOSK_CONFIRM_MS, KIOSK_IDLE_MS } from "./kiosk";

describe("kiosk lock timing", () => {
  it("returns to the PIN pad after a short confirm and idle window", () => {
    expect(KIOSK_CONFIRM_MS).toBe(1600);
    expect(KIOSK_IDLE_MS).toBe(20_000);
  });
});
