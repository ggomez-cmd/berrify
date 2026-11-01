import { describe, expect, it } from "vitest";
import { readableIssue } from "./format";

const EMP = "3826ed7d-b1e0-4f9b-99ff-8dd36c8dbeaf";
const REST = "b860ab3d-f509-4dc9-ab63-d5672a69f361";
const SHIFT = "0bf213f0-6b93-4186-ab55-227ed52c0a3c";

describe("readableIssue", () => {
  const names = { [EMP]: "Cook One" };
  const restaurants = { [REST]: "North Kitchen" };

  it("names the employee in a missing-rate error", () => {
    expect(readableIssue(`Missing rate for employee ${EMP} (Cook) on 2026-09-07`, names, restaurants)).toBe(
      "Missing rate for employee Cook One (Cook) on 2026-09-07",
    );
  });

  it("turns a restaurant-scoped position key into position at restaurant", () => {
    expect(
      readableIssue(`Shift ${SHIFT} has no rate for employee ${EMP} position Cook::${REST} on 2026-09-11`, names, restaurants),
    ).toBe(`Shift ${SHIFT} has no rate for employee Cook One position Cook at North Kitchen on 2026-09-11`);
  });

  it("leaves unknown ids alone", () => {
    const text = `Missing rate for employee ${SHIFT} (Host) on 2026-09-07`;
    expect(readableIssue(text, names, restaurants)).toBe(text);
  });
});
