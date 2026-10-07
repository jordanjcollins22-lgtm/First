import { describe, expect, it } from "vitest";

import { dueOccurrences, renderCheckInMessage, zonedWallTimeToUtc } from "./schedule";

const WEEKDAYS = [1, 2, 3, 4, 5];

describe("zonedWallTimeToUtc", () => {
  it("converts New York local time in winter (EST, -5)", () => {
    const at = zonedWallTimeToUtc({ year: 2026, month: 1, day: 15 }, 8, 0, "America/New_York");
    expect(at.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("converts New York local time in summer (EDT, -4)", () => {
    const at = zonedWallTimeToUtc({ year: 2026, month: 7, day: 15 }, 8, 0, "America/New_York");
    expect(at.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("handles the DST switch day", () => {
    // 2026-03-08: clocks jump 2am -> 3am in New York. 9am is EDT.
    const at = zonedWallTimeToUtc({ year: 2026, month: 3, day: 8 }, 9, 0, "America/New_York");
    expect(at.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
});

describe("dueOccurrences", () => {
  const schedule = { days_of_week: WEEKDAYS, time_of_day: "08:00" };
  const tz = "America/New_York";

  it("returns the occurrence when the cron runs shortly after it", () => {
    // Wed 2026-10-07 08:03 EDT
    const now = new Date("2026-10-07T12:03:00Z");
    expect(dueOccurrences(schedule, tz, now, 15).map((d) => d.toISOString())).toEqual([
      "2026-10-07T12:00:00.000Z",
    ]);
  });

  it("returns nothing before the time or once outside the lookback", () => {
    expect(dueOccurrences(schedule, tz, new Date("2026-10-07T11:59:00Z"), 15)).toEqual([]);
    expect(dueOccurrences(schedule, tz, new Date("2026-10-07T12:30:00Z"), 15)).toEqual([]);
  });

  it("includes the exact boundary instant", () => {
    expect(dueOccurrences(schedule, tz, new Date("2026-10-07T12:00:00Z"), 15)).toHaveLength(1);
  });

  it("skips days not in the schedule", () => {
    // Sat 2026-10-10 08:05 EDT
    expect(dueOccurrences(schedule, tz, new Date("2026-10-10T12:05:00Z"), 15)).toEqual([]);
  });

  it("catches a late-night occurrence across local midnight", () => {
    const late = { days_of_week: [3], time_of_day: "23:55" }; // Wednesdays
    // Thu 2026-10-08 00:05 EDT -> Wed 23:55 was 10 min ago.
    const now = new Date("2026-10-08T04:05:00Z");
    expect(dueOccurrences(late, tz, now, 15).map((d) => d.toISOString())).toEqual([
      "2026-10-08T03:55:00.000Z",
    ]);
  });

  it("ignores malformed times", () => {
    expect(dueOccurrences({ days_of_week: WEEKDAYS, time_of_day: "8am" }, tz, new Date(), 60)).toEqual([]);
  });
});

describe("renderCheckInMessage", () => {
  it("fills placeholders with the first name and job", () => {
    expect(
      renderCheckInMessage("Hey {name}, how's {job} going?", { name: "Marcus Lee", job: "Smith mulch" })
    ).toBe("Hey Marcus, how's Smith mulch going?");
  });

  it("falls back when there's no job", () => {
    expect(renderCheckInMessage("{name}: status on {job}?", { name: "Ana" })).toBe(
      "Ana: status on today's job?"
    );
  });
});
