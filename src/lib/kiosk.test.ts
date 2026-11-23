import { describe, expect, it } from "vitest";
import {
  KIOSK_CONFIRM_MS,
  KIOSK_IDLE_MS,
  KIOSK_PATH,
  canOpenKiosk,
  isKioskLogin,
  kioskLockRedirect,
  shouldPromptKioskExit,
} from "./kiosk";
import { isAdmin, isManager, visibleShiftsForRole } from "./schedule";

describe("kiosk lock timing", () => {
  it("returns to the PIN pad after a short confirm and idle window", () => {
    expect(KIOSK_CONFIRM_MS).toBe(1600);
    expect(KIOSK_IDLE_MS).toBe(20_000);
  });
});

describe("shouldPromptKioskExit", () => {
  it("prompts unless the org has no admin PIN configured", () => {
    expect(shouldPromptKioskExit(true)).toBe(true);
    expect(shouldPromptKioskExit(undefined)).toBe(true);
    expect(shouldPromptKioskExit(false)).toBe(false);
  });
});

describe("kiosk login role", () => {
  it("is only the kiosk membership role", () => {
    expect(isKioskLogin("kiosk")).toBe(true);
    expect(isKioskLogin("admin")).toBe(false);
    expect(isKioskLogin("manager")).toBe(false);
    expect(isKioskLogin("staff")).toBe(false);
    expect(isKioskLogin(null)).toBe(false);
  });

  it("opens the kiosk only on a kiosk login", () => {
    expect(canOpenKiosk("kiosk")).toBe(true);
    expect(canOpenKiosk("admin")).toBe(false);
    expect(canOpenKiosk("manager")).toBe(false);
    expect(canOpenKiosk("staff")).toBe(false);
    expect(canOpenKiosk(null)).toBe(false);
  });

  it("is neither manager nor admin", () => {
    expect(isManager("kiosk")).toBe(false);
    expect(isAdmin("kiosk")).toBe(false);
  });

  it("sees no shifts", () => {
    const shifts = [{ status: "published" as const, employee_id: "e1" }];
    expect(visibleShiftsForRole(shifts, "kiosk", null)).toEqual([]);
  });
});

describe("kioskLockRedirect", () => {
  it("sends a kiosk login from every other page to the kiosk", () => {
    for (const path of [
      "/",
      "/schedule",
      "/time-clock",
      "/time-clock/shifts",
      "/employees",
      "/inventory",
      "/invoices",
      "/suppliers",
      "/movements",
      "/payroll",
      "/payroll/runs/abc",
      "/quickbooks",
      "/empty-bottles",
    ]) {
      expect(kioskLockRedirect("kiosk", path)).toBe(KIOSK_PATH);
    }
  });

  it("leaves a kiosk login on the kiosk", () => {
    expect(kioskLockRedirect("kiosk", "/kiosk")).toBeNull();
  });

  it("does not redirect other roles", () => {
    for (const role of ["admin", "manager", "staff", null] as const) {
      expect(kioskLockRedirect(role, "/")).toBeNull();
      expect(kioskLockRedirect(role, "/schedule")).toBeNull();
      expect(kioskLockRedirect(role, "/kiosk")).toBeNull();
    }
  });
});
