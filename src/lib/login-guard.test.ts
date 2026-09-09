import { afterEach, describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  isHoneypotFilled,
  loginLockRemainingMs,
  recordLoginFailure,
} from "./login-guard";

afterEach(() => {
  clearLoginFailures();
});

describe("loginLockRemainingMs", () => {
  it("is unlocked before any failures", () => {
    expect(loginLockRemainingMs(1_000)).toBe(0);
  });
});

describe("recordLoginFailure", () => {
  it("locks after five failures", () => {
    expect(recordLoginFailure(1_000)).toBe(0);
    expect(recordLoginFailure(1_001)).toBe(0);
    expect(recordLoginFailure(1_002)).toBe(0);
    expect(recordLoginFailure(1_003)).toBe(0);
    expect(recordLoginFailure(1_004)).toBe(30_000);
    expect(loginLockRemainingMs(1_010)).toBe(29_994);
  });

  it("stays locked until the window ends", () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure(1_000);
    expect(recordLoginFailure(10_000)).toBe(21_000);
  });
});

describe("isHoneypotFilled", () => {
  it("treats whitespace as empty", () => {
    expect(isHoneypotFilled("")).toBe(false);
    expect(isHoneypotFilled("  ")).toBe(false);
    expect(isHoneypotFilled("http://spam.example")).toBe(true);
  });
});
