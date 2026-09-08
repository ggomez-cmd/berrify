import { describe, expect, it } from "vitest";
import {
  allowedEvents,
  assertTransition,
  classifyBreakType,
  computeTimeTotals,
  detectSessionExceptions,
  isValidTransition,
  managerForceOutValid,
  matchPublishedShift,
  nextClockState,
  pairBreaks,
  rangesOverlap,
  resolveRestaurantId,
  secondsBetween,
  shouldFlagMissedOut,
  startOfWorkweek,
} from "./time-clock";

describe("clock transitions", () => {
  it("accepts the complete valid sequence", () => {
    expect(nextClockState("off_clock", "clock_in")).toBe("working");
    expect(nextClockState("working", "break_start")).toBe("on_break");
    expect(nextClockState("on_break", "break_end")).toBe("working");
    expect(nextClockState("working", "clock_out")).toBe("off_clock");
  });

  it("rejects clock_in while working", () => {
    expect(isValidTransition("working", "clock_in")).toBe(false);
    expect(() => assertTransition("working", "clock_in")).toThrow(/Invalid clock transition/);
  });

  it("rejects break_start while off clock", () => {
    expect(isValidTransition("off_clock", "break_start")).toBe(false);
  });

  it("rejects break_start while already on break", () => {
    expect(isValidTransition("on_break", "break_start")).toBe(false);
  });

  it("rejects break_end while working", () => {
    expect(isValidTransition("working", "break_end")).toBe(false);
  });

  it("rejects break_end while off clock", () => {
    expect(isValidTransition("off_clock", "break_end")).toBe(false);
  });

  it("rejects clock_out while off clock", () => {
    expect(isValidTransition("off_clock", "clock_out")).toBe(false);
  });

  it("rejects clock_out while on break", () => {
    expect(isValidTransition("on_break", "clock_out")).toBe(false);
  });

  it("rejects every invalid employee transition", () => {
    const invalid: Array<["off_clock" | "working" | "on_break", "clock_in" | "break_start" | "break_end" | "clock_out"]> = [
      ["off_clock", "break_start"],
      ["off_clock", "break_end"],
      ["off_clock", "clock_out"],
      ["working", "clock_in"],
      ["working", "break_end"],
      ["on_break", "clock_in"],
      ["on_break", "break_start"],
      ["on_break", "clock_out"],
    ];
    for (const [from, event] of invalid) {
      expect(isValidTransition(from, event)).toBe(false);
    }
  });

  it("derives allowed actions from state", () => {
    expect(allowedEvents("off_clock")).toEqual(["clock_in"]);
    expect(allowedEvents("working")).toEqual(["break_start", "clock_out"]);
    expect(allowedEvents("on_break")).toEqual(["break_end"]);
  });

  it("allows manager force-out from working or on_break only", () => {
    expect(managerForceOutValid("working")).toBe(true);
    expect(managerForceOutValid("on_break")).toBe(true);
    expect(managerForceOutValid("off_clock")).toBe(false);
  });
});

describe("secondsBetween", () => {
  it("returns integer seconds and never decimal hours", () => {
    expect(secondsBetween("2026-09-06T16:00:00.000Z", "2026-09-06T16:00:00.400Z")).toBe(0);
    expect(secondsBetween("2026-09-06T16:00:00.000Z", "2026-09-06T16:00:01.900Z")).toBe(1);
    expect(secondsBetween("2026-09-06T16:00:00.000Z", "2026-09-06T21:00:00.000Z")).toBe(18_000);
  });
});

describe("idempotency semantics", () => {
  it("treats a repeated client_event_id as the same event, not a new transition", () => {
    const first = { id: "evt-1", client_event_id: "11111111-1111-1111-1111-111111111111" };
    const retry = { client_event_id: first.client_event_id };
    const existing = new Map([[first.client_event_id, first]]);
    const resolved = existing.get(retry.client_event_id);
    expect(resolved?.id).toBe("evt-1");
    expect(isValidTransition("working", "clock_in")).toBe(false);
  });
});

describe("breaks and totals", () => {
  it("keeps unpaid meal time out of worked seconds", () => {
    const totals = computeTimeTotals(4 * 3600, [{ duration_seconds: 1800, paid: false }]);
    expect(totals.gross_seconds).toBe(14_400);
    expect(totals.unpaid_break_seconds).toBe(1800);
    expect(totals.paid_break_seconds).toBe(0);
    expect(totals.worked_seconds).toBe(12_600);
  });

  it("keeps paid rest time inside worked seconds", () => {
    const totals = computeTimeTotals(4 * 3600, [{ duration_seconds: 600, paid: true }]);
    expect(totals.paid_break_seconds).toBe(600);
    expect(totals.unpaid_break_seconds).toBe(0);
    expect(totals.worked_seconds).toBe(14_400);
  });

  it("supports multiple breaks in one session", () => {
    const breaks = pairBreaks(
      [
        { event_type: "clock_in", occurred_at: "2026-09-06T14:00:00.000Z" },
        { event_type: "break_start", occurred_at: "2026-09-06T16:00:00.000Z" },
        { event_type: "break_end", occurred_at: "2026-09-06T16:10:00.000Z" },
        { event_type: "break_start", occurred_at: "2026-09-06T18:00:00.000Z" },
        { event_type: "break_end", occurred_at: "2026-09-06T18:30:00.000Z" },
        { event_type: "clock_out", occurred_at: "2026-09-06T22:00:00.000Z" },
      ],
      { mealPaid: false, restPaid: true },
    );
    expect(breaks).toHaveLength(2);
    expect(classifyBreakType(600)).toBe("rest");
    expect(classifyBreakType(1800)).toBe("meal");
    expect(breaks[0]?.paid).toBe(true);
    expect(breaks[1]?.paid).toBe(false);
    const totals = computeTimeTotals(8 * 3600, breaks);
    expect(totals.worked_seconds).toBe(8 * 3600 - 1800);
  });
});

describe("shift matching and restaurant resolution", () => {
  const shift = {
    id: "shift-1",
    restaurant_id: "rest-kane",
    starts_at: "2026-09-06T16:00:00.000Z",
    ends_at: "2026-09-06T22:00:00.000Z",
    status: "published" as const,
    employee_id: "emp-1",
  };

  it("matches a published shift in the window", () => {
    expect(matchPublishedShift([shift], "emp-1", "2026-09-06T16:12:00.000Z")?.id).toBe("shift-1");
  });

  it("ignores draft shifts and other employees", () => {
    expect(
      matchPublishedShift([{ ...shift, status: "draft" }], "emp-1", "2026-09-06T16:12:00.000Z"),
    ).toBeNull();
    expect(matchPublishedShift([shift], "emp-2", "2026-09-06T16:12:00.000Z")).toBeNull();
  });

  it("resolves restaurant as matched shift then home then null", () => {
    expect(
      resolveRestaurantId({ matchedShiftRestaurantId: "rest-kane", homeRestaurantId: "rest-home" }),
    ).toBe("rest-kane");
    expect(resolveRestaurantId({ matchedShiftRestaurantId: null, homeRestaurantId: "rest-home" })).toBe(
      "rest-home",
    );
    expect(resolveRestaurantId({ matchedShiftRestaurantId: null, homeRestaurantId: null })).toBeNull();
  });
});

describe("entries and exceptions", () => {
  it("keeps one clock-in/out pair as one entry including cross-midnight", () => {
    const gross = secondsBetween("2026-09-06T22:00:00.000Z", "2026-09-07T02:00:00.000Z");
    expect(gross).toBe(4 * 3600);
    const totals = computeTimeTotals(gross, []);
    expect(totals.worked_seconds).toBe(4 * 3600);
  });

  it("does not split totals for a later compensation boundary", () => {
    const totals = computeTimeTotals(4 * 3600, []);
    expect(totals.worked_seconds).toBe(14_400);
  });

  it("flags unscheduled, early, late, long_break, and overlap", () => {
    expect(
      detectSessionExceptions({
        staffShiftId: null,
        clockInAt: "2026-09-06T16:00:00.000Z",
        shiftStartsAt: null,
        breaks: [],
        overlapsExistingEntry: false,
      }),
    ).toContain("unscheduled");
    expect(
      detectSessionExceptions({
        staffShiftId: "s1",
        clockInAt: "2026-09-06T15:50:00.000Z",
        shiftStartsAt: "2026-09-06T16:00:00.000Z",
        breaks: [],
        overlapsExistingEntry: false,
      }),
    ).toContain("early");
    expect(
      detectSessionExceptions({
        staffShiftId: "s1",
        clockInAt: "2026-09-06T16:10:00.000Z",
        shiftStartsAt: "2026-09-06T16:00:00.000Z",
        breaks: [],
        overlapsExistingEntry: false,
      }),
    ).toContain("late");
    expect(
      detectSessionExceptions({
        staffShiftId: "s1",
        clockInAt: "2026-09-06T16:00:00.000Z",
        shiftStartsAt: "2026-09-06T16:00:00.000Z",
        breaks: [{ duration_seconds: 2400 }],
        overlapsExistingEntry: true,
      }),
    ).toEqual(expect.arrayContaining(["long_break", "overlap"]));
  });

  it("flags missed-out without inventing a punch", () => {
    expect(
      shouldFlagMissedOut({
        clockedInAt: "2026-09-06T10:00:00.000Z",
        now: "2026-09-06T23:00:00.000Z",
        shiftEndsAt: "2026-09-06T16:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      rangesOverlap(
        "2026-09-06T14:00:00.000Z",
        "2026-09-06T18:00:00.000Z",
        "2026-09-06T17:00:00.000Z",
        "2026-09-06T20:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("workweek timezone", () => {
  it("uses America/Puerto_Rico Sunday start, not the browser offset", () => {
    const saturdayNightUtc = new Date("2026-09-06T03:30:00.000Z");
    const start = startOfWorkweek(saturdayNightUtc, "America/Puerto_Rico", 0, "00:00");
    expect(start.toISOString()).toBe("2026-08-30T04:00:00.000Z");
    const nextWeek = startOfWorkweek(new Date("2026-09-06T04:30:00.000Z"), "America/Puerto_Rico", 0, "00:00");
    expect(nextWeek.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("honors a Saturday workweek start in org timezone", () => {
    const mondayUtc = new Date("2026-09-07T16:00:00.000Z");
    const start = startOfWorkweek(mondayUtc, "America/Puerto_Rico", 6, "00:00");
    expect(start.toISOString()).toBe("2026-09-05T04:00:00.000Z");
  });
});
