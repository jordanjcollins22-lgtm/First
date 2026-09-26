import { describe, expect, it } from "vitest";

import {
  driveMinutes,
  milesBetween,
  NEIGHBOUR_MILES,
  rankSlot,
  rankSlots,
  recommendSlots,
  type BookedNearby,
} from "./booking-recommendation";
import type { AvailableSlotGroup } from "./booking-availability";

const NOW = new Date(2026, 8, 9, 8, 0);
const HOME = { lat: 39.5, lng: -76.35 };

const slot = (date: string, time: string): AvailableSlotGroup => ({ date, time, evaluatorIds: ["e1"] });

/** An evaluation already booked, at a distance expressed in degrees of latitude. */
const booked = (iso: string, endIso: string | null, latOffset: number): BookedNearby => ({
  iso,
  endIso,
  lat: HOME.lat + latOffset,
  lng: HOME.lng,
});

// About 0.0145 degrees of latitude is a mile.
const MILE = 1 / 69;

describe("distance and drive time", () => {
  it("is null when either end has no position", () => {
    expect(milesBetween({ lat: null, lng: null }, HOME)).toBeNull();
  });

  it("is about a mile for a mile", () => {
    const miles = milesBetween(HOME, { lat: HOME.lat + MILE, lng: HOME.lng })!;
    expect(miles).toBeGreaterThan(0.95);
    expect(miles).toBeLessThan(1.05);
  });

  it("allows for getting in and out of the van, not just the driving", () => {
    // Three miles at thirty is six minutes; nobody does it in six.
    expect(driveMinutes(3)).toBeGreaterThan(15);
  });
});

describe("scoring one free hour", () => {
  it("prefers the hour next to work already booked nearby", () => {
    // Half a mile: comfortably inside the "minutes away" claim rather than
    // sitting on its boundary, which is what the next test is for.
    const nearby = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", MILE / 2)];
    const adjacent = rankSlot(slot("2026-09-10", "10:30"), HOME, nearby, NOW);
    const alone = rankSlot(slot("2026-09-10", "15:00"), HOME, [], NOW);
    expect(adjacent.score).toBeGreaterThan(alone.score);
    expect(adjacent.says).toBe("We're minutes away just before this");
  });

  it("says nothing about being close when it is not close", () => {
    const faraway = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", 30 * MILE)];
    const s = rankSlot(slot("2026-09-10", "14:00"), HOME, faraway, NOW);
    expect(s.says).toBeNull();
  });

  it("refuses to dress up an arrival it cannot make", () => {
    // Twenty-five miles away, finishing at ten, and this starts at 10:20.
    const tight = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", 25 * MILE)];
    const s = rankSlot(slot("2026-09-10", "10:20"), HOME, tight, NOW);
    expect(s.reachable).toBe(false);
    expect(s.score).toBeLessThan(rankSlot(slot("2026-09-10", "15:00"), HOME, [], NOW).score);
  });

  it("counts a gap it can make as reachable", () => {
    const ok = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", 5 * MILE)];
    expect(rankSlot(slot("2026-09-10", "11:00"), HOME, ok, NOW).reachable).toBe(true);
  });

  it("ignores work booked on a different day", () => {
    // Four miles from tomorrow's job saves nobody anything today.
    const other = [booked("2026-09-11T09:00:00", "2026-09-11T10:00:00", MILE)];
    const s = rankSlot(slot("2026-09-10", "10:30"), HOME, other, NOW);
    expect(s.nearestMiles).toBeNull();
    expect(s.says).toBeNull();
  });

  it("prefers sooner, all else equal", () => {
    const soon = rankSlot(slot("2026-09-10", "10:00"), HOME, [], NOW);
    const later = rankSlot(slot("2026-09-20", "10:00"), HOME, [], NOW);
    expect(soon.score).toBeGreaterThan(later.score);
  });

  it("claims nothing at all when the address is not known yet", () => {
    const nearby = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", MILE)];
    const s = rankSlot(slot("2026-09-10", "10:30"), { lat: null, lng: null }, nearby, NOW);
    expect(s.nearestMiles).toBeNull();
    expect(s.says).toBeNull();
  });

  it("does not claim to be on their street, at any distance", () => {
    // The distance is a great-circle guess, not a walk down the road, so no
    // copy anywhere in here is allowed to promise a street.
    for (const offset of [MILE / 4, MILE, 3 * MILE]) {
      const nearby = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", offset)];
      const s = rankSlot(slot("2026-09-10", "10:30"), HOME, nearby, NOW);
      expect(s.says ?? "").not.toContain("street");
    }
  });

  it("steps down its claim once past a mile", () => {
    const nearby = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", 3 * MILE)];
    expect(rankSlot(slot("2026-09-10", "10:30"), HOME, nearby, NOW).says).toBe(
      "We're already close by around then"
    );
  });

  it("never names another client, a place or a time in what it says", () => {
    const nearby = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", MILE)];
    for (const s of rankSlots([slot("2026-09-10", "10:30"), slot("2026-09-10", "08:00")], HOME, nearby, NOW)) {
      if (!s.says) continue;
      expect(s.says).not.toMatch(/\d/);
      expect(s.says.toLowerCase()).not.toContain("address");
    }
  });
});

describe("what gets put in front of somebody", () => {
  const spread = [
    slot("2026-09-10", "09:00"),
    slot("2026-09-10", "10:00"),
    slot("2026-09-10", "11:00"),
    slot("2026-09-11", "09:00"),
    slot("2026-09-12", "09:00"),
  ];

  it("offers at most one time a day, so three options are three choices", () => {
    const picks = recommendSlots(rankSlots(spread, HOME, [], NOW));
    expect(new Set(picks.map((p) => p.date)).size).toBe(picks.length);
  });

  it("offers three when there are three days to offer", () => {
    expect(recommendSlots(rankSlots(spread, HOME, [], NOW))).toHaveLength(3);
  });

  it("always includes the soonest, even when it routes badly", () => {
    // Plenty of people want the earliest date and nothing else. Hiding it to
    // save ourselves a drive is optimising the wrong side of the deal.
    const nearby = [booked("2026-09-12T09:00:00", "2026-09-12T10:00:00", MILE)];
    const picks = recommendSlots(rankSlots(spread, HOME, nearby, NOW));
    expect(picks[0].date).toBe("2026-09-10");
    expect(picks[0].time).toBe("09:00");
  });

  it("gives the soonest something to say even when it has no cluster", () => {
    expect(recommendSlots(rankSlots(spread, HOME, [], NOW))[0].says).toBe("Soonest we can get to you");
  });

  it("never recommends a time it would arrive late to", () => {
    const tight = [booked("2026-09-11T08:00:00", "2026-09-11T09:00:00", 25 * MILE)];
    const picks = recommendSlots(rankSlots(spread, HOME, tight, NOW));
    const eleventh = picks.find((p) => p.date === "2026-09-11");
    expect(eleventh === undefined || eleventh.reachable).toBe(true);
  });

  it("copes with nothing free at all", () => {
    expect(recommendSlots(rankSlots([], HOME, [], NOW))).toEqual([]);
  });

  it("treats five miles as the edge of the same trip", () => {
    expect(NEIGHBOUR_MILES).toBe(5);
    const edge = [booked("2026-09-10T09:00:00", "2026-09-10T10:00:00", 6 * MILE)];
    expect(rankSlot(slot("2026-09-10", "11:00"), HOME, edge, NOW).says).toBeNull();
  });
});
