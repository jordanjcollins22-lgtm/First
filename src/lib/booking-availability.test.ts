import { describe, expect, it } from "vitest";

import { computeAvailableSlots, SLOT_MINUTES } from "@/lib/booking-availability";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

const EVALUATOR = "e1";
const FROM = new Date("2026-09-01T00:00:00");

/** Tuesday 1 Sep 2026, 09:00–13:00. */
const weekly: WeeklyAvailability[] = [
  {
    id: "w1",
    profile_id: EVALUATOR,
    day_of_week: new Date("2026-09-01T12:00:00").getDay(),
    start_time: "09:00:00",
    end_time: "13:00:00",
  } as unknown as WeeklyAvailability,
];

function slots(bookedTimes: { evaluatorId: string; iso: string; endIso?: string | null }[]) {
  return computeAvailableSlots({
    evaluatorIds: [EVALUATOR],
    weeklyAvailability: weekly,
    daysOff: [] as DayOff[],
    bookedTimes,
    from: FROM,
    daysAhead: 1,
    minLeadMinutes: 0,
  }).map((s) => s.time);
}

function at(hour: number): string {
  return new Date(2026, 8, 1, hour, 0, 0).toISOString();
}

describe("computeAvailableSlots", () => {
  it("offers the whole window when nothing is booked", () => {
    expect(slots([])).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("blocks the slot an appointment starts in", () => {
    expect(slots([{ evaluatorId: EVALUATOR, iso: at(10) }])).not.toContain("10:00");
  });

  it("blocks every slot a long appointment covers", () => {
    // The bug end times exist to fix: a two-hour visit used to block only the
    // hour it started in, leaving the second hour bookable underneath it.
    const booked = [{ evaluatorId: EVALUATOR, iso: at(10), endIso: at(12) }];
    expect(slots(booked)).toEqual(["09:00", "12:00"]);
  });

  it("assumes the default length when no end was recorded", () => {
    const booked = [{ evaluatorId: EVALUATOR, iso: at(10), endIso: null }];
    expect(slots(booked)).toEqual(["09:00", "11:00", "12:00"]);
    expect(SLOT_MINUTES).toBe(60);
  });

  it("does not block the slot a visit finishes on", () => {
    // A visit ending at 11:00 and a slot starting at 11:00 is back-to-back.
    const booked = [{ evaluatorId: EVALUATOR, iso: at(9), endIso: at(11) }];
    expect(slots(booked)).toContain("11:00");
  });

  it("leaves another evaluator's calendar alone", () => {
    expect(slots([{ evaluatorId: "someone-else", iso: at(10), endIso: at(12) }])).toHaveLength(4);
  });
});
