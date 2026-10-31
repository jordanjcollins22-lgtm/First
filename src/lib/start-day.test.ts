import { describe, expect, it } from "vitest";

import { isStartDayOption, START_DAY_WINDOW, startDayOptions } from "@/lib/start-day";

// Friday 30 October 2026, midday in Maryland.
const now = new Date("2026-10-30T16:00:00Z");

describe("startDayOptions", () => {
  const days = startDayOptions(now, "America/New_York");

  it("starts tomorrow and skips Sundays", () => {
    expect(days[0]).toBe("2026-10-31");
    expect(days).not.toContain("2026-11-01");
    expect(days[1]).toBe("2026-11-02");
  });

  it("offers three weeks of days, in order, no repeats", () => {
    expect(days).toHaveLength(START_DAY_WINDOW);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });

  it("only accepts a day it offered", () => {
    expect(isStartDayOption("2026-11-02", now, "America/New_York")).toBe(true);
    expect(isStartDayOption("2026-10-30", now, "America/New_York")).toBe(false);
    expect(isStartDayOption("2026-11-01", now, "America/New_York")).toBe(false);
    expect(isStartDayOption("2027-01-01", now, "America/New_York")).toBe(false);
    expect(isStartDayOption(null, now)).toBe(false);
  });
});
