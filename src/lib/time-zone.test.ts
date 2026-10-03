import { describe, expect, it } from "vitest";

import {
  dateKeyIn,
  dayOnly,
  minutesIn,
  offsetMinutesAt,
  parseAsBusinessTime,
  shortWhen,
  timeOnly,
  wallClockIn,
  zonedToUtc,
} from "@/lib/time-zone";

describe("the business clock", () => {
  it("turns Monday at 8 in Maryland into the right instant, summer and winter", () => {
    expect(zonedToUtc("2026-09-14", "08:00").toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(zonedToUtc("2026-12-14", "08:00").toISOString()).toBe("2026-12-14T13:00:00.000Z");
    expect(offsetMinutesAt(new Date("2026-09-14T12:00:00Z"))).toBe(-240);
    expect(offsetMinutesAt(new Date("2026-12-14T13:00:00Z"))).toBe(-300);
  });

  it("reads the clock on the wall back off an instant", () => {
    const at = new Date("2026-09-14T12:00:00Z");
    expect(wallClockIn(at)).toMatchObject({ year: 2026, month: 9, day: 14, hour: 8, minute: 0, weekday: 1 });
    expect(dateKeyIn(at)).toBe("2026-09-14");
    expect(minutesIn(at)).toBe(480);
    // Late evening in Maryland is already tomorrow in UTC, and the day is Maryland's.
    expect(dateKeyIn(new Date("2026-09-15T02:30:00Z"))).toBe("2026-09-14");
  });

  it("formats on the business clock wherever the server happens to be", () => {
    expect(shortWhen("2026-09-14T12:00:00Z")).toBe("Mon, Sep 14, 8:00 AM");
    expect(timeOnly("2026-09-14T12:00:00Z")).toBe("8:00 AM");
    expect(dayOnly("2026-09-14T12:00:00Z")).toBe("Monday, September 14");
    expect(shortWhen("nonsense")).toBe("nonsense");
  });

  it("reads an outside timestamp the way its sender meant it", () => {
    expect(parseAsBusinessTime("2026-09-14T08:00:00").toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(parseAsBusinessTime("2026-09-14T08:00:00-04:00").toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(parseAsBusinessTime("2026-09-14T12:00:00Z").toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  it("refuses a date it cannot read rather than inventing one", () => {
    expect(Number.isNaN(zonedToUtc("14/09/2026", "08:00").getTime())).toBe(true);
    expect(Number.isNaN(zonedToUtc("2026-09-14", "8").getTime())).toBe(true);
  });
});
