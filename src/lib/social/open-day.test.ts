import { describe, expect, it } from "vitest";

import { hourFor, nextOpenSlot, readSlots } from "@/lib/social/open-day";

describe("nextOpenSlot", () => {
  // Wednesday 18 November 2026, 7 AM in New York.
  const now = new Date("2026-11-18T12:00:00Z");

  it("starts tomorrow, never today", () => {
    const slot = nextOpenSlot({ now, taken: new Set(), slots: [] });
    expect(slot?.dateKey).toBe("2026-11-19");
  });

  it("skips days that already have a post", () => {
    const slot = nextOpenSlot({ now, taken: new Set(["2026-11-19", "2026-11-20"]), slots: [] });
    expect(slot?.dateKey).toBe("2026-11-21");
  });

  it("posts at 10 AM New York time when the weekday has no best slot", () => {
    const slot = nextOpenSlot({ now, taken: new Set(), slots: [] });
    expect(slot?.at.toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });

  it("uses the best-time slot for that weekday", () => {
    // 19 Nov 2026 is a Thursday (4).
    const slot = nextOpenSlot({ now, taken: new Set(), slots: [{ weekday: 4, hour: 18 }] });
    expect(slot?.at.toISOString()).toBe("2026-11-19T23:00:00.000Z");
  });

  it("gives up when four weeks are full", () => {
    const taken = new Set<string>();
    for (let i = 1; i <= 28; i += 1) taken.add(new Date(Date.UTC(2026, 10, 18 + i, 12)).toISOString().slice(0, 10));
    expect(nextOpenSlot({ now, taken, slots: [] })).toBeNull();
  });
});

describe("slots", () => {
  it("drops malformed slots", () => {
    expect(readSlots([{ weekday: 2, hour: 10 }, { weekday: 9, hour: 1 }, "x"])).toEqual([{ weekday: 2, hour: 10 }]);
    expect(readSlots(null)).toEqual([]);
  });
  it("falls back to 10 AM", () => {
    expect(hourFor(3, [{ weekday: 2, hour: 9 }])).toBe(10);
  });
});
