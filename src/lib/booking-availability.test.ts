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

describe("computeAvailableSlots — other calendars", () => {
  // The bug this whole change exists for: the booking page offered a client
  // ten o'clock with somebody who had been on a patio install since eight,
  // because installs live on a different calendar and nothing joined them up.
  const weekly = [
    { profile_id: "p1", day_of_week: 3, start_time: "08:00", end_time: "17:00" },
  ] as unknown as Parameters<typeof computeAvailableSlots>[0]["weeklyAvailability"];

  // A Wednesday, well clear of the lead time.
  const FROM = new Date(2026, 7, 18, 9, 0, 0);

  function slotsWith(busy: Parameters<typeof computeAvailableSlots>[0]["busy"]) {
    return computeAvailableSlots({
      evaluatorIds: ["p1"],
      weeklyAvailability: weekly,
      daysOff: [],
      bookedTimes: [],
      busy,
      from: FROM,
      daysAhead: 3,
    });
  }

  it("offers the day when nothing else is on", () => {
    expect(slotsWith([]).some((s) => s.date === "2026-08-19" && s.time === "10:00")).toBe(true);
  });

  it("takes the whole day off the board when they are on a job", () => {
    const onAJob = [
      {
        profileId: "p1",
        start: new Date(2026, 7, 19, 0, 0),
        end: new Date(2026, 7, 20, 0, 0),
        source: "work_visit" as const,
        label: "40 Oak Ave",
        jobId: "j2",
      },
    ];
    expect(slotsWith(onAJob).some((s) => s.date === "2026-08-19")).toBe(false);
  });

  it("only takes the hours the other booking actually covers", () => {
    const meeting = [
      {
        profileId: "p1",
        start: new Date(2026, 7, 19, 10, 0),
        end: new Date(2026, 7, 19, 11, 0),
        source: "evaluation" as const,
        label: "12 Elm St",
        jobId: "j3",
      },
    ];
    const slots = slotsWith(meeting);
    expect(slots.some((s) => s.date === "2026-08-19" && s.time === "10:00")).toBe(false);
    expect(slots.some((s) => s.date === "2026-08-19" && s.time === "11:00")).toBe(true);
  });

  it("does not block one evaluator with somebody else's commitment", () => {
    const someoneElse = [
      {
        profileId: "p9",
        start: new Date(2026, 7, 19, 0, 0),
        end: new Date(2026, 7, 20, 0, 0),
        source: "work_visit" as const,
        label: "40 Oak Ave",
        jobId: "j2",
      },
    ];
    expect(someoneElse && slotsWith(someoneElse).some((s) => s.date === "2026-08-19")).toBe(true);
  });
});
