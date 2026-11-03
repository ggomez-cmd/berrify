import { describe, expect, it } from "vitest";
import { nextPeriod, periodContaining, lastEndedPeriod } from "./schedules";

const weekly = {
  frequency: "weekly" as const,
  anchor_period_start: "2026-10-12",
  check_lag_days: 5,
};

const biweekly = {
  frequency: "biweekly" as const,
  anchor_period_start: "2026-10-12",
  check_lag_days: 5,
};

describe("periodContaining", () => {
  it("returns the weekly period that contains the date, including the ends", () => {
    expect(periodContaining(weekly, "2026-10-12")).toEqual({
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      checkDate: "2026-10-23",
    });
    expect(periodContaining(weekly, "2026-10-18")).toEqual({
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      checkDate: "2026-10-23",
    });
    expect(periodContaining(weekly, "2026-10-19")).toEqual({
      periodStart: "2026-10-19",
      periodEnd: "2026-10-25",
      checkDate: "2026-10-30",
    });
  });

  it("walks biweekly periods backward from the anchor without timezone drift", () => {
    expect(periodContaining(biweekly, "2026-10-11")).toEqual({
      periodStart: "2026-09-28",
      periodEnd: "2026-10-11",
      checkDate: "2026-10-16",
    });
    expect(periodContaining(biweekly, "2026-09-28")).toEqual({
      periodStart: "2026-09-28",
      periodEnd: "2026-10-11",
      checkDate: "2026-10-16",
    });
  });

  it("uses ymd prefixes so timestamptz values do not shift the calendar day", () => {
    expect(periodContaining(weekly, "2026-10-18T23:00:00.000Z").periodEnd).toBe("2026-10-18");
  });
});

describe("lastEndedPeriod", () => {
  it("returns the period before the one in progress, even on its last day", () => {
    const schedule = { frequency: "biweekly" as const, anchor_period_start: "2026-10-18", check_lag_days: 6 };
    expect(lastEndedPeriod(schedule, "2026-11-02")).toEqual({
      periodStart: "2026-10-18",
      periodEnd: "2026-10-31",
      checkDate: "2026-11-06",
    });
    expect(lastEndedPeriod(schedule, "2026-11-14").periodEnd).toBe("2026-10-31");
    expect(lastEndedPeriod(schedule, "2026-11-15").periodEnd).toBe("2026-11-14");
  });
});

describe("nextPeriod", () => {
  it("returns the period after the one that contains the date", () => {
    expect(nextPeriod(weekly, "2026-10-15")).toEqual({
      periodStart: "2026-10-19",
      periodEnd: "2026-10-25",
      checkDate: "2026-10-30",
    });
    expect(nextPeriod(biweekly, "2026-10-12")).toEqual({
      periodStart: "2026-10-26",
      periodEnd: "2026-11-08",
      checkDate: "2026-11-13",
    });
  });
});
