import { describe, expect, it } from "vitest";

import { localDay, localWeekKey, nextCappedSlot, reslotOverdue } from "./social-autopost";

describe("weekly cap", () => {
  // Monday 13 Oct 2026, 9am New York.
  const monday = new Date("2026-10-12T13:00:00Z");

  it("keys a moment by its local Monday", () => {
    expect(localWeekKey("2026-10-14T14:00:00Z")).toBe("2026-10-12");
    // Sunday evening in New York is still that week, though it is Monday in UTC.
    expect(localWeekKey("2026-10-19T02:00:00Z")).toBe("2026-10-12");
    expect(localDay("2026-10-19T02:00:00Z")).toBe("2026-10-18");
  });

  it("takes the next slot while the week has room, then moves to the next week", () => {
    const first = nextCappedSlot([], 2, monday);
    expect(first).not.toBeNull();
    expect(localWeekKey(first!)).toBe("2026-10-12");
    const second = nextCappedSlot([first!.toISOString()], 2, monday);
    expect(localWeekKey(second!)).toBe("2026-10-12");
    const third = nextCappedSlot([first!.toISOString(), second!.toISOString()], 2, monday);
    expect(localWeekKey(third!)).toBe("2026-10-19");
  });
});

describe("re-slotting", () => {
  const now = new Date("2026-10-13T16:00:00Z");
  it("moves posts stuck in the past to separate future slots, oldest first", () => {
    const moves = reslotOverdue(
      [
        { id: "b", scheduledFor: "2026-10-06T14:00:00Z" },
        { id: "a", scheduledFor: "2026-10-01T14:00:00Z" },
        { id: "recent", scheduledFor: "2026-10-13T14:00:00Z" },
      ],
      [],
      now
    );
    expect(moves.map((m) => m.id)).toEqual(["a", "b"]);
    expect(Date.parse(moves[0].scheduledFor)).toBeGreaterThan(now.getTime());
    expect(Date.parse(moves[1].scheduledFor) - Date.parse(moves[0].scheduledFor)).toBeGreaterThanOrEqual(20 * 3_600_000);
  });
});
