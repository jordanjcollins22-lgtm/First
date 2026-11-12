import { describe, expect, it } from "vitest";

import { cadenceProblems, DEFAULT_SOCIAL_CADENCE, fillSlots, slotLabel, slotTimes, tidyCadence, upcomingSlotsFor, type SocialCadence } from "./cadence";

// Thursday 12 November 2026, 10am Eastern (EST, UTC-5).
const NOW = new Date("2026-11-12T15:00:00Z");
const both = ["facebook", "instagram"];
const cadence = (over: Partial<SocialCadence["perWeek"]> = {}): SocialCadence => ({ ...DEFAULT_SOCIAL_CADENCE, perWeek: { ...DEFAULT_SOCIAL_CADENCE.perWeek, ...over } });

describe("defaults", () => {
  it("post 4 a week on Facebook and 4 on Instagram at the best times", () => {
    expect(DEFAULT_SOCIAL_CADENCE.perWeek).toEqual({ facebook: 4, instagram: 4 });
    expect(DEFAULT_SOCIAL_CADENCE.slots.slice(0, 4).map(slotLabel)).toEqual(["Tue 10am", "Thu 6pm", "Sat 9am", "Sun 5pm"]);
    expect(DEFAULT_SOCIAL_CADENCE.autofill).toBe(true);
  });
});

describe("tidyCadence", () => {
  it("falls back to the defaults", () => {
    expect(tidyCadence(null)).toEqual(DEFAULT_SOCIAL_CADENCE);
    expect(tidyCadence({})).toEqual(DEFAULT_SOCIAL_CADENCE);
  });
  it("clamps numbers and cleans slots", () => {
    const c = tidyCadence({ facebook_per_week: "99", instagram_per_week: -3, slots: [{ weekday: 2, hour: 10 }, { weekday: 2, hour: 10 }, { weekday: 9, hour: 1 }, { weekday: "1", hour: "7" }, null], autofill: false });
    expect(c.perWeek).toEqual({ facebook: 14, instagram: 0 });
    expect(c.slots).toEqual([{ weekday: 2, hour: 10 }, { weekday: 1, hour: 7 }]);
    expect(c.autofill).toBe(false);
  });
  it("says when there are fewer times than posts", () => {
    expect(cadenceProblems(cadence({ facebook: 7 }))).toEqual(["7 a week needs 7 posting times; there are 6."]);
    expect(cadenceProblems(DEFAULT_SOCIAL_CADENCE)).toEqual([]);
  });
});

describe("slotTimes", () => {
  it("are on the Eastern clock across the daylight-saving change", () => {
    const times = slotTimes({ ...DEFAULT_SOCIAL_CADENCE, slots: [{ weekday: 2, hour: 10 }] }, new Date("2027-03-08T12:00:00Z"), 2);
    // Tue 9 Mar is EST (UTC-5), Tue 16 Mar is EDT (UTC-4).
    expect(times.map((t) => t.at.toISOString())).toEqual(["2027-03-09T15:00:00.000Z", "2027-03-16T14:00:00.000Z"]);
  });
  it("skip a slot less than half an hour away", () => {
    const times = slotTimes(DEFAULT_SOCIAL_CADENCE, new Date("2026-11-12T22:45:00Z"), 1);
    expect(times[0].at.toISOString()).not.toBe("2026-11-12T23:00:00.000Z");
  });
});

describe("fillSlots", () => {
  it("fills this week's remaining top slots, then next week's", () => {
    const waiting = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, platforms: both }));
    const out = fillSlots({ cadence: DEFAULT_SOCIAL_CADENCE, waiting, booked: [], now: NOW });
    expect(out.map((a) => a.scheduledFor)).toEqual([
      "2026-11-12T23:00:00.000Z", // Thu 6pm
      "2026-11-14T14:00:00.000Z", // Sat 9am
      "2026-11-15T22:00:00.000Z", // Sun 5pm
      "2026-11-17T15:00:00.000Z", // Tue 10am
      "2026-11-19T23:00:00.000Z", // Thu 6pm
      "2026-11-21T14:00:00.000Z", // Sat 9am
    ]);
    expect(out.map((a) => a.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("counts what the week already has", () => {
    const booked = ["2026-11-09T15:00:00Z", "2026-11-10T15:00:00Z", "2026-11-11T15:00:00Z", "2026-11-12T12:00:00Z"].map((at) => ({ at, platforms: both }));
    const out = fillSlots({ cadence: DEFAULT_SOCIAL_CADENCE, waiting: [{ id: "a", platforms: both }], booked, now: NOW });
    expect(out).toEqual([{ id: "a", scheduledFor: "2026-11-17T15:00:00.000Z" }]);
  });

  it("keeps each account to its own number a week", () => {
    const c = cadence({ instagram: 2 });
    const out = fillSlots({
      cadence: c,
      waiting: [
        { id: "both1", platforms: both },
        { id: "both2", platforms: both },
        { id: "fb", platforms: ["facebook"] },
      ],
      booked: [],
      now: NOW,
    });
    // Instagram uses only Tue 10am and Thu 6pm; Facebook-only can take Saturday.
    expect(out).toEqual([
      { id: "both1", scheduledFor: "2026-11-12T23:00:00.000Z" },
      { id: "both2", scheduledFor: "2026-11-17T15:00:00.000Z" },
      { id: "fb", scheduledFor: "2026-11-14T14:00:00.000Z" },
    ]);
  });

  it("leaves a gap after a post already on that account", () => {
    const out = fillSlots({ cadence: DEFAULT_SOCIAL_CADENCE, waiting: [{ id: "fb", platforms: ["facebook"] }], booked: [{ at: "2026-11-12T20:00:00Z", platforms: ["facebook"] }], now: NOW });
    expect(out[0].scheduledFor).toBe("2026-11-14T14:00:00.000Z");
  });

  it("skips posts for accounts switched off", () => {
    const out = fillSlots({ cadence: cadence({ instagram: 0 }), waiting: [{ id: "ig", platforms: ["instagram"] }, { id: "b", platforms: both }], booked: [], now: NOW });
    expect(out).toEqual([{ id: "b", scheduledFor: "2026-11-12T23:00:00.000Z" }]);
  });

  it("never gives two posts the same slot", () => {
    const waiting = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, platforms: i % 2 ? ["facebook"] : ["instagram"] }));
    const out = fillSlots({ cadence: DEFAULT_SOCIAL_CADENCE, waiting, booked: [], now: NOW });
    expect(new Set(out.map((a) => a.scheduledFor)).size).toBe(out.length);
  });
});

describe("upcomingSlotsFor", () => {
  it("lists the next times an account would post", () => {
    expect(upcomingSlotsFor(DEFAULT_SOCIAL_CADENCE, "facebook", NOW, 4).map((d) => d.toISOString())).toEqual([
      "2026-11-12T23:00:00.000Z",
      "2026-11-14T14:00:00.000Z",
      "2026-11-15T22:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
  });
});
