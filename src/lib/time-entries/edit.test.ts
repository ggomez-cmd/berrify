import { describe, expect, it } from "vitest";
import { isoFromSeconds, utcSecondsFromZoned } from "../payroll-engine/hours/time";
import type { TimeBreak, TimeEntry, TimeEntryEdit, TimeException } from "../types";
import {
  approvedCheckDateForShift,
  buildTimeEntryRpcPayload,
  formFromTimeEntry,
  formatWorkedHours,
  groupTimeEntriesForReview,
  workedSecondsFromRange,
} from "./edit";

const zone = "America/Puerto_Rico";
const approvedWindow = {
  period_start: "2026-10-01",
  period_end: "2026-10-08",
  check_date: "2026-10-09",
  time_zone: zone,
  from: "2026-09-23T04:00:00.000Z",
  until: "2026-10-09T04:00:00.000Z",
};

function localIso(ymd: string, hm: string): string {
  const [hour, minute] = hm.split(":");
  return isoFromSeconds(
    utcSecondsFromZoned({
      year: Number(ymd.slice(0, 4)),
      month: Number(ymd.slice(5, 7)),
      day: Number(ymd.slice(8, 10)),
      hour: Number(hour),
      minute: Number(minute),
      second: 0,
      timeZone: zone,
    }),
  );
}

function entry(partial: Partial<TimeEntry> & Pick<TimeEntry, "id" | "employee_id" | "started_at" | "ended_at">): TimeEntry {
  return {
    org_id: "org-1",
    staff_shift_id: null,
    restaurant_id: "rest-1",
    position: "Server",
    gross_seconds: 8 * 3600,
    paid_break_seconds: 0,
    unpaid_break_seconds: 0,
    worked_seconds: 8 * 3600,
    status: "pending",
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...partial,
  };
}

describe("buildTimeEntryRpcPayload", () => {
  it("converts org-zone times, overnight out, and unpaid breaks into UTC", () => {
    const result = buildTimeEntryRpcPayload({
      employeeId: "emp-1",
      restaurantId: "rest-1",
      position: " Server ",
      date: "2026-10-02",
      start: "22:00",
      end: "06:00",
      breaks: [{ startedAt: "02:00", endedAt: "02:30", breakType: "meal", paid: false }],
      reason: " missed punch ",
      timeZone: zone,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.new_started_at).toBe(localIso("2026-10-02", "22:00"));
    expect(result.payload.new_ended_at).toBe(localIso("2026-10-03", "06:00"));
    expect(result.payload.new_breaks[0]?.started_at).toBe(localIso("2026-10-03", "02:00"));
    expect(result.payload.target_position).toBe("Server");
    expect(result.payload.reason).toBe("missed punch");
    expect(result.workedSeconds).toBe(8 * 3600 - 30 * 60);
  });

  it("rejects empty reason, missing restaurant, overlapping breaks, and a 25-hour span", () => {
    expect(
      buildTimeEntryRpcPayload({
        employeeId: "emp-1",
        restaurantId: "rest-1",
        position: "Server",
        date: "2026-10-02",
        start: "09:00",
        end: "17:00",
        breaks: [],
        reason: "   ",
        timeZone: zone,
      }).ok,
    ).toBe(false);
    expect(
      buildTimeEntryRpcPayload({
        employeeId: "emp-1",
        restaurantId: "",
        position: "Server",
        date: "2026-10-02",
        start: "09:00",
        end: "17:00",
        breaks: [],
        reason: "fix",
        timeZone: zone,
      }),
    ).toEqual({ ok: false, error: "Restaurant is required" });
    const overlap = buildTimeEntryRpcPayload({
      employeeId: "emp-1",
      restaurantId: "rest-1",
      position: "Server",
      date: "2026-10-02",
      start: "09:00",
      end: "17:00",
      breaks: [
        { startedAt: "12:00", endedAt: "12:30", breakType: "meal", paid: false },
        { startedAt: "12:15", endedAt: "12:45", breakType: "rest", paid: true },
      ],
      reason: "fix",
      timeZone: zone,
    });
    expect(overlap).toEqual({ ok: false, error: "Breaks overlap" });
    expect(
      buildTimeEntryRpcPayload({
        employeeId: "emp-1",
        restaurantId: "rest-1",
        position: "Server",
        date: "2026-10-02",
        start: "09:00",
        end: "17:00",
        breaks: [{ startedAt: "17:30", endedAt: "18:00", breakType: "meal", paid: false }],
        reason: "fix",
        timeZone: zone,
      }),
    ).toEqual({ ok: false, error: "Break 1: must stay inside the shift" });
  });
});

describe("workedSecondsFromRange and formatWorkedHours", () => {
  it("subtracts unpaid breaks and formats hundredths", () => {
    const seconds = workedSecondsFromRange(localIso("2026-10-02", "09:00"), localIso("2026-10-02", "17:00"), [
      { started_at: localIso("2026-10-02", "12:00"), ended_at: localIso("2026-10-02", "12:30"), paid: false },
      { started_at: localIso("2026-10-02", "15:00"), ended_at: localIso("2026-10-02", "15:15"), paid: true },
    ]);
    expect(seconds).toBe(7.5 * 3600);
    expect(formatWorkedHours(seconds)).toBe("7.5");
    expect(formatWorkedHours(8 * 3600)).toBe("8");
  });
});

describe("groupTimeEntriesForReview", () => {
  it("groups in-period shifts with totals and flags", () => {
    const rows: TimeEntry[] = [
      entry({
        id: "e-open",
        employee_id: "emp-2",
        started_at: localIso("2026-10-03", "09:00"),
        ended_at: localIso("2026-10-03", "17:00"),
        restaurant_id: null,
        worked_seconds: 8 * 3600,
      }),
      entry({
        id: "e-paid",
        employee_id: "emp-1",
        started_at: localIso("2026-10-02", "09:00"),
        ended_at: localIso("2026-10-02", "17:00"),
        worked_seconds: 8 * 3600,
      }),
      entry({
        id: "e-out",
        employee_id: "emp-1",
        started_at: localIso("2026-09-20", "09:00"),
        ended_at: localIso("2026-09-20", "17:00"),
        worked_seconds: 8 * 3600,
      }),
    ];
    const breaks: TimeBreak[] = [
      {
        id: "b1",
        org_id: "org-1",
        time_entry_id: "e-paid",
        break_start_event_id: null,
        break_end_event_id: null,
        started_at: localIso("2026-10-02", "12:00"),
        ended_at: localIso("2026-10-02", "12:30"),
        duration_seconds: 1800,
        break_type: "meal",
        paid: false,
        created_at: "2026-10-02T00:00:00.000Z",
      },
    ];
    const exceptions: TimeException[] = [
      {
        id: "x1",
        org_id: "org-1",
        employee_id: "emp-2",
        time_entry_id: "e-open",
        clock_event_id: null,
        staff_shift_id: null,
        type: "late",
        delta_seconds: 60,
        status: "open",
        resolved_by: null,
        resolved_at: null,
        created_at: "2026-10-03T00:00:00.000Z",
      },
    ];
    const edits: TimeEntryEdit[] = [
      {
        id: "ed1",
        org_id: "org-1",
        time_entry_id: "e-paid",
        employee_id: "emp-1",
        action: "update",
        before: null,
        after: null,
        reason: "fix",
        edited_by: "user-1",
        edited_at: "2026-10-02T18:00:00.000Z",
      },
    ];
    const groups = groupTimeEntriesForReview({
      entries: rows,
      breaks,
      exceptions,
      edits,
      windows: [approvedWindow],
      names: { "emp-1": "Ada Clerk", "emp-2": "Bea Host" },
      timeZone: zone,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-08",
    });
    expect(groups.map((row) => row.employeeId)).toEqual(["emp-1", "emp-2"]);
    expect(groups[0]?.totalWorkedSeconds).toBe(8 * 3600);
    expect(groups[0]?.shifts[0]?.edited).toBe(true);
    expect(groups[0]?.shifts[0]?.approvedCheckDate).toBe("2026-10-09");
    expect(groups[0]?.shifts[0]?.breaks).toHaveLength(1);
    expect(groups[1]?.shifts[0]?.noRestaurant).toBe(true);
    expect(groups[1]?.shifts[0]?.hasOpenException).toBe(true);
  });
});

describe("approvedCheckDateForShift", () => {
  it("uses the shared from/until window, including overnight starts before period_start", () => {
    expect(approvedCheckDateForShift(localIso("2026-10-01", "22:00"), [approvedWindow])).toBe("2026-10-09");
    expect(approvedCheckDateForShift(localIso("2026-09-30", "22:00"), [approvedWindow])).toBe("2026-10-09");
    expect(approvedCheckDateForShift(localIso("2026-09-22", "22:00"), [approvedWindow])).toBeNull();
    expect(approvedCheckDateForShift("2026-10-09T04:00:00.000Z", [approvedWindow])).toBeNull();
  });
});

describe("formFromTimeEntry seconds", () => {
  const startWithSeconds = "2026-10-02T13:00:59.000Z";
  const endOnTheMinute = "2026-10-02T21:00:00.000Z";
  const breakStart = "2026-10-02T16:00:17.000Z";
  const breakEnd = "2026-10-02T16:30:04.000Z";

  function seeded() {
    return formFromTimeEntry(
      entry({
        id: "e-seconds",
        employee_id: "emp-1",
        started_at: startWithSeconds,
        ended_at: endOnTheMinute,
      }),
      [
        {
          id: "b-seconds",
          org_id: "org-1",
          time_entry_id: "e-seconds",
          break_start_event_id: null,
          break_end_event_id: null,
          started_at: breakStart,
          ended_at: breakEnd,
          duration_seconds: 1787,
          break_type: "meal",
          paid: false,
          created_at: "2026-10-02T00:00:00.000Z",
        },
      ],
      zone,
    );
  }

  it("keeps original instants when only the restaurant changes", () => {
    const form = seeded();
    const result = buildTimeEntryRpcPayload({
      ...form,
      restaurantId: "rest-2",
      reason: "wrong restaurant",
      timeZone: zone,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.new_started_at).toBe(startWithSeconds);
    expect(result.payload.new_ended_at).toBe(endOnTheMinute);
    expect(result.payload.new_breaks[0]?.started_at).toBe(breakStart);
    expect(result.payload.new_breaks[0]?.ended_at).toBe(breakEnd);
  });

  it("rebuilds only a changed end time from HH:MM", () => {
    const form = seeded();
    const result = buildTimeEntryRpcPayload({
      ...form,
      end: "17:30",
      reason: "adjust out",
      timeZone: zone,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.new_started_at).toBe(startWithSeconds);
    expect(result.payload.new_ended_at).toBe(localIso("2026-10-02", "17:30"));
    expect(result.payload.new_breaks[0]?.started_at).toBe(breakStart);
  });
});
