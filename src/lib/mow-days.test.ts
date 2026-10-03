import { describe, expect, it } from "vitest";

import { dayLabel, isOpenDay, openMowDays } from "@/lib/mow-days";

// Friday Oct 2 2026, early afternoon in Maryland.
const now = new Date("2026-10-02T17:00:00Z");

describe("days a first mow can be booked", () => {
  it("starts tomorrow and skips Sundays", () => {
    const days = openMowDays(now, {}, 18, 4);
    expect(days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05", "2026-10-06"]);
    expect(days[0].label).toBe("Sat, Oct 3");
  });

  it("counts spots left and leaves out a full day", () => {
    const days = openMowDays(now, { "2026-10-03": 17, "2026-10-05": 18 }, 18, 4);
    expect(days.map((d) => [d.date, d.spotsLeft])).toEqual([
      ["2026-10-03", 1],
      ["2026-10-06", 18],
    ]);
  });

  it("uses the business clock, not the server's", () => {
    // 11:30 PM Thursday in Maryland is already Friday in UTC: tomorrow is still Friday.
    const late = new Date("2026-10-02T03:30:00Z");
    expect(openMowDays(late, {}, 18, 1)[0].date).toBe("2026-10-02");
  });

  it("only takes a day it offered", () => {
    const days = openMowDays(now, {}, 18, 4);
    expect(isOpenDay("2026-10-05", days)).toBe(true);
    expect(isOpenDay("2026-10-04", days)).toBe(false);
    expect(isOpenDay("2026-10-02", days)).toBe(false);
  });

  it("writes a day the way a person reads it", () => {
    expect(dayLabel("2026-10-06")).toBe("Tue, Oct 6");
  });
});
