import { describe, expect, it } from "vitest";

import { hoursForJob, stintsForDay, type ClockEntryRow, type CrewEventRow } from "./crew-hours";

const DAY = "2026-10-13";
// 12:00Z is 08:00 in New York in October (EDT, UTC-4).
const t = (hhmm: string, day = DAY) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + 4, m)).toISOString();
};
const ev = (profileId: string, kind: CrewEventRow["kind"], at: string, jobId: string | null = null, day = DAY): CrewEventRow => ({
  profileId,
  kind,
  jobId,
  at: t(at, day),
  day,
});

describe("stintsForDay", () => {
  it("splits a two-stop day into travel and on-site per job", () => {
    const day = stintsForDay([
      ev("a", "arrived_shop", "07:00"),
      ev("a", "left_shop", "07:30"),
      ev("a", "travelling", "07:31", "j1"),
      ev("a", "arrived_job", "08:00", "j1"),
      ev("a", "finished_job", "11:00", "j1"),
      ev("a", "travelling", "11:10", "j2"),
      ev("a", "arrived_job", "11:30", "j2"),
      ev("a", "finished_job", "15:00", "j2"),
      ev("a", "returned_shop", "15:45"),
    ]);
    expect(day.stints).toHaveLength(2);
    const [one, two] = day.stints;
    // Travel to the first stop starts when they left the shop.
    expect(one).toMatchObject({ jobId: "j1", travelHours: 0.5, onSiteHours: 3, endedBy: "finished" });
    // Travel to the second starts when they finished the first.
    expect(two).toMatchObject({ jobId: "j2", travelHours: 0.5, onSiteHours: 3.5, endedBy: "finished" });
    // Morning at the shop (0.5h) and the drive back (0.75h) are no job's.
    expect(day.unallocatedHours).toBeCloseTo(1.25, 5);
  });

  it("starts travel at the 'on my way' tap on a meet-on-site day", () => {
    const day = stintsForDay([
      ev("a", "travelling", "07:40", "j1"),
      ev("a", "arrived_job", "08:10", "j1"),
      ev("a", "finished_job", "12:10", "j1"),
      ev("a", "returned_shop", "12:30"),
    ]);
    expect(day.stints[0]).toMatchObject({ travelHours: 0.5, onSiteHours: 4 });
  });

  it("ends an unfinished stop at 'Back at the shop' after the day", () => {
    const day = stintsForDay([
      ev("a", "left_shop", "07:30"),
      ev("a", "arrived_job", "08:00", "j1"),
      ev("a", "returned_shop", "14:00"),
    ]);
    expect(day.stints[0]).toMatchObject({ onSiteHours: 6, endedBy: "returned_shop" });
  });

  it("counts nothing for an unfinished stop with no end, and says so", () => {
    const day = stintsForDay([ev("a", "left_shop", "07:30"), ev("a", "arrived_job", "08:00", "j1")]);
    expect(day.stints[0]).toMatchObject({ onSiteHours: 0, travelHours: 0.5, endedBy: "open" });
  });

  it("measures an open stop to now when reading live", () => {
    const day = stintsForDay([ev("a", "left_shop", "07:30"), ev("a", "arrived_job", "08:00", "j1")], new Date(t("10:30")));
    expect(day.stints[0]).toMatchObject({ onSiteHours: 2.5, endedBy: "now" });
  });
});

describe("hoursForJob", () => {
  const twoPeople: CrewEventRow[] = [
    ev("lead", "left_shop", "07:30"),
    ev("lead", "arrived_job", "08:00", "j1"),
    ev("lead", "finished_job", "12:00", "j1"),
    ev("tech", "left_shop", "07:30"),
    ev("tech", "arrived_job", "08:00", "j1"),
    ev("tech", "finished_job", "11:00", "j1"),
    // The tech went on to another job; that time is not j1's.
    ev("tech", "arrived_job", "11:30", "j2"),
    ev("tech", "finished_job", "14:00", "j2"),
  ];

  it("adds up crew-hours per person, only for the job asked about", () => {
    const h = hoursForJob("j1", twoPeople, []);
    expect(h.totalHours).toBe(8);
    expect(h.travelHours).toBe(1);
    expect(h.onSiteHours).toBe(7);
    expect(h.people.map((p) => [p.profileId, p.hours])).toEqual([
      ["lead", 4.5],
      ["tech", 3.5],
    ]);
  });

  it("uses the clock only where the crew day has nothing for that person and day", () => {
    const clock: ClockEntryRow[] = [
      // Same person, same day as their events: ignored, or it counts twice.
      { profileId: "lead", jobId: "j1", clockedInAt: t("07:00"), clockedOutAt: t("13:00") },
      // A different day with no taps: counted.
      { profileId: "lead", jobId: "j1", clockedInAt: t("08:00", "2026-10-14"), clockedOutAt: t("10:00", "2026-10-14") },
      // Another job: not this one's.
      { profileId: "lead", jobId: "j9", clockedInAt: t("08:00", "2026-10-15"), clockedOutAt: t("10:00", "2026-10-15") },
    ];
    const h = hoursForJob("j1", twoPeople, clock);
    const lead = h.people.find((p) => p.profileId === "lead")!;
    expect(lead.hours).toBe(6.5);
    expect(lead.source).toBe("both");
    expect(lead.days).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("costs a clock-only person as clock hours", () => {
    const h = hoursForJob("j1", [], [{ profileId: "x", jobId: "j1", clockedInAt: t("08:00"), clockedOutAt: t("09:15") }]);
    expect(h.people[0]).toMatchObject({ profileId: "x", hours: 1.25, source: "clock" });
  });

  it("does not count a still-running clock entry unless reading live", () => {
    const open: ClockEntryRow[] = [{ profileId: "x", jobId: "j1", clockedInAt: t("08:00"), clockedOutAt: null }];
    expect(hoursForJob("j1", [], open)).toMatchObject({ totalHours: 0, openClockEntries: 1 });
    expect(hoursForJob("j1", [], open, { now: new Date(t("10:00")) }).totalHours).toBe(2);
  });

  it("flags unclosed stops instead of inventing an end", () => {
    const h = hoursForJob("j1", [ev("a", "arrived_job", "08:00", "j1")], []);
    expect(h.unclosedStops).toBe(1);
    expect(h.totalHours).toBe(0);
  });

  it("only measures today's open stop to now, not an old one", () => {
    const old = [ev("a", "arrived_job", "08:00", "j1", "2026-10-10")];
    const h = hoursForJob("j1", old, [], { now: new Date(t("10:00")) });
    expect(h.unclosedStops).toBe(1);
    expect(h.totalHours).toBe(0);
  });
});
