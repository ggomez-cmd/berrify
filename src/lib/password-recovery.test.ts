import { afterEach, describe, expect, it } from "vitest";
import {
  readPasswordRecoveryFlag,
  setPasswordRecoveryFlag,
  shouldTreatSessionAsRecovery,
  urlIndicatesPasswordRecovery,
} from "./password-recovery";

afterEach(() => {
  sessionStorage.clear();
});

describe("password recovery", () => {
  it("persists the recovery flag in sessionStorage", () => {
    expect(readPasswordRecoveryFlag()).toBe(false);
    setPasswordRecoveryFlag(true);
    expect(readPasswordRecoveryFlag()).toBe(true);
    setPasswordRecoveryFlag(false);
    expect(readPasswordRecoveryFlag()).toBe(false);
  });

  it("detects recovery from the hash type", () => {
    expect(
      urlIndicatesPasswordRecovery({
        pathname: "/reset-password",
        search: "",
        hash: "#access_token=abc&type=recovery",
      }),
    ).toBe(true);
  });

  it("detects recovery from a PKCE code on the reset path", () => {
    expect(
      urlIndicatesPasswordRecovery({
        pathname: "/reset-password",
        search: "?code=pkce-code",
        hash: "",
      }),
    ).toBe(true);
  });

  it("does not treat a normal login path as recovery", () => {
    expect(
      urlIndicatesPasswordRecovery({
        pathname: "/login",
        search: "",
        hash: "",
      }),
    ).toBe(false);
    expect(
      shouldTreatSessionAsRecovery({
        pathname: "/reset-password",
        search: "",
        hash: "",
      }),
    ).toBe(false);
  });

  it("treats a stored flag as recovery even without URL params", () => {
    setPasswordRecoveryFlag(true);
    expect(
      shouldTreatSessionAsRecovery({
        pathname: "/reset-password",
        search: "",
        hash: "",
      }),
    ).toBe(true);
  });
});
