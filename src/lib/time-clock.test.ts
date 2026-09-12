import { describe, expect, it } from "vitest";

import {
  checkEdit,
  dayByPerson,
  dayWageTotal,
  describeHours,
  hoursByJob,
  hoursOn,
  isOpen,
  onTheClock,
  overlapping,
  payFor,
  type Person,
  type TimeEntry,
} from "@/lib/time-clock";

const NOW = new Date("2026-08-27T17:00:00Z");

function entry(over: Partial<TimeEntry> & { id: string }): TimeEntry {
  return {
    profileId: "mike",
    personName: "Mike R.",
    jobId: "j1",
    jobName: "Whittaker",
    sessionId: null,
    clockedInAt: "2026-08-27T13:00:00Z",
    clockedOutAt: "2026-08-27T16:00:00Z",
    note: null,
    editedByName: null,
    ...over,
  };
}

const PEOPLE: Person[] = [
  { id: "mike", name: "Mike R.", payType: "hourly", payRatePerHour: 22 },
  { id: "dave", name: "Dave K.", payType: "commission", payRatePerHour: null },
  { id: "sam", name: "Sam T.", payType: "both", payRatePerHour: 25 },
  { id: "pat", name: "Pat L.", payType: "hourly", payRatePerHour: null },
];

describe("how long somebody was on it", () => {
  it("measures a finished entry between its two times", () => {
    expect(hoursOn(entry({ id: "a" }), NOW)).toBe(3);
  });

  it("measures an open entry up to now", () => {
    // "Three hours so far" is the answer somebody looking at a screen at
    // eleven in the morning wants.
    expect(hoursOn(entry({ id: "a", clockedOutAt: null }), NOW)).toBe(4);
    expect(isOpen(entry({ id: "a", clockedOutAt: null }))).toBe(true);
  });

  it("treats a finish before a start as nothing, not as negative time", () => {
    const backwards = entry({ id: "a", clockedOutAt: "2026-08-27T12:00:00Z" });
    expect(hoursOn(backwards, NOW)).toBe(0);
  });

  it("says it the way somebody says it out loud", () => {
    expect(describeHours(3)).toBe("3h");
    expect(describeHours(3.5)).toBe("3h 30m");
    expect(describeHours(0.25)).toBe("15m");
  });
});

describe("who is on right now", () => {
  it("returns only the open ones, oldest first", () => {
    const open = onTheClock([
      entry({ id: "done" }),
      entry({ id: "late", clockedOutAt: null, clockedInAt: "2026-08-27T15:00:00Z" }),
      entry({ id: "early", clockedOutAt: null, clockedInAt: "2026-08-27T13:00:00Z" }),
    ]);
    expect(open.map((e) => e.id)).toEqual(["early", "late"]);
  });
});

describe("what a day cost", () => {
  it("adds a person's entries and prices them", () => {
    const [day] = dayByPerson([entry({ id: "a" })], PEOPLE, NOW);
    expect(day.hours).toBe(3);
    expect(day.pay).toBe(66);
  });

  it("gives a commission-only person no figure rather than a zero", () => {
    // A zero in a pay column reads as "worked for nothing" rather than "not
    // how this one is paid".
    const [day] = dayByPerson([entry({ id: "a", profileId: "dave", personName: "Dave K." })], PEOPLE, NOW);
    expect(day.hours).toBe(3);
    expect(day.pay).toBeNull();
  });

  it("pays somebody on both, because their hours are still hours", () => {
    const [day] = dayByPerson([entry({ id: "a", profileId: "sam", personName: "Sam T." })], PEOPLE, NOW);
    expect(day.pay).toBe(75);
  });

  it("leaves pay blank when there is no rate on file", () => {
    // A blank asks a question; a made-up zero answers one wrongly.
    const [day] = dayByPerson([entry({ id: "a", profileId: "pat", personName: "Pat L." })], PEOPLE, NOW);
    expect(day.pay).toBeNull();
  });

  it("flags a person who is still on the clock", () => {
    const [day] = dayByPerson([entry({ id: "a", clockedOutAt: null })], PEOPLE, NOW);
    expect(day.stillOn).toBe(true);
    expect(day.hours).toBe(4);
  });

  it("totals the wages, counting only what is actually priced", () => {
    const days = dayByPerson(
      [entry({ id: "a" }), entry({ id: "b", profileId: "dave", personName: "Dave K." })],
      PEOPLE,
      NOW
    );
    expect(dayWageTotal(days)).toBe(66);
  });

  it("sorts the longest day first", () => {
    const days = dayByPerson(
      [
        entry({ id: "a", clockedInAt: "2026-08-27T15:00:00Z" }),
        entry({ id: "b", profileId: "sam", personName: "Sam T." }),
      ],
      PEOPLE,
      NOW
    );
    expect(days[0].personName).toBe("Sam T.");
  });

  it("prices hours on their own", () => {
    expect(payFor(3, 22, "hourly")).toBe(66);
    expect(payFor(3, 22, "commission")).toBeNull();
    expect(payFor(3, null, "hourly")).toBeNull();
  });
});

describe("hours on a job", () => {
  it("adds everybody's time on it and counts the heads", () => {
    const jobs = hoursByJob(
      [entry({ id: "a" }), entry({ id: "b", profileId: "sam", personName: "Sam T." })],
      NOW
    );
    expect(jobs[0]).toMatchObject({ jobId: "j1", hours: 6, peopleCount: 2 });
  });

  it("ignores time booked to no job at all", () => {
    expect(hoursByJob([entry({ id: "a", jobId: null })], NOW)).toEqual([]);
  });
});

describe("entries that cannot both be true", () => {
  it("flags one person clocked into two places at once", () => {
    // Somebody forgot to clock out, and it inflates both hours and pay.
    const clash = overlapping(
      [
        entry({ id: "a", clockedInAt: "2026-08-27T13:00:00Z", clockedOutAt: "2026-08-27T16:00:00Z" }),
        entry({ id: "b", clockedInAt: "2026-08-27T15:00:00Z", clockedOutAt: "2026-08-27T16:30:00Z" }),
      ],
      NOW
    );
    expect(clash.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("leaves back-to-back entries alone", () => {
    const fine = overlapping(
      [
        entry({ id: "a", clockedOutAt: "2026-08-27T16:00:00Z" }),
        entry({ id: "b", clockedInAt: "2026-08-27T16:00:00Z", clockedOutAt: "2026-08-27T16:30:00Z" }),
      ],
      NOW
    );
    expect(fine).toEqual([]);
  });

  it("does not flag two different people on the same job", () => {
    const fine = overlapping(
      [entry({ id: "a" }), entry({ id: "b", profileId: "sam", personName: "Sam T." })],
      NOW
    );
    expect(fine).toEqual([]);
  });
});

describe("correcting the times", () => {
  it("accepts a sensible correction", () => {
    expect(checkEdit("2026-08-27T13:00:00Z", "2026-08-27T16:00:00Z", NOW).ok).toBe(true);
  });

  it("accepts leaving somebody still on the clock", () => {
    expect(checkEdit("2026-08-27T13:00:00Z", null, NOW).ok).toBe(true);
  });

  it("refuses an entry that finishes before it starts", () => {
    const verdict = checkEdit("2026-08-27T16:00:00Z", "2026-08-27T13:00:00Z", NOW);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("before it starts");
  });

  it("refuses times in the future", () => {
    expect(checkEdit("2026-08-28T09:00:00Z", null, NOW).ok).toBe(false);
    expect(checkEdit("2026-08-27T13:00:00Z", "2026-08-28T09:00:00Z", NOW).ok).toBe(false);
  });

  it("forgives a clock a few seconds fast", () => {
    expect(checkEdit("2026-08-27T17:00:30Z", null, NOW).ok).toBe(true);
  });

  it("refuses nonsense", () => {
    expect(checkEdit("not a time", null, NOW).ok).toBe(false);
    expect(checkEdit("2026-08-27T13:00:00Z", "not a time", NOW).ok).toBe(false);
  });
});
