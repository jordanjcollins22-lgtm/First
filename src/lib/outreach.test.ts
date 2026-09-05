import { describe, expect, it } from "vitest";

import {
  playbookSteps,
  progressFor,
  resultsFor,
  summariseDay,
  type ChannelShape,
  type TouchShape,
} from "@/lib/outreach";

const TODAY = "2026-08-19";

function channel(o: Partial<ChannelShape> & { id: string }): ChannelShape {
  return {
    key: "cold_call",
    name: "Cold calling",
    temperature: "cold",
    costType: "free",
    summary: null,
    playbook: null,
    dailyTarget: 30,
    active: true,
    sortOrder: 10,
    ...o,
  };
}

function touch(o: Partial<TouchShape> & { channelId: string }): TouchShape {
  return { outcome: "attempted", day: TODAY, profileId: "p1", ...o };
}

describe("playbookSteps", () => {
  it("splits a playbook into steps and drops the stored numbering", () => {
    // The numbering is the list's job. A stored "1." goes stale the moment
    // somebody inserts a step above it.
    expect(playbookSteps("1. Ring them\n2. Book the visit")).toEqual(["Ring them", "Book the visit"]);
  });

  it("ignores blank lines rather than rendering empty steps", () => {
    expect(playbookSteps("Ring them\n\n  \nBook it")).toEqual(["Ring them", "Book it"]);
  });

  it("has nothing to say about a channel with no playbook yet", () => {
    expect(playbookSteps(null)).toEqual([]);
  });
});

describe("progressFor", () => {
  it("counts only today against the target", () => {
    const touches = [
      touch({ channelId: "c1" }),
      touch({ channelId: "c1" }),
      touch({ channelId: "c1", day: "2026-08-18" }),
    ];
    const [p] = progressFor([channel({ id: "c1" })], touches, TODAY);
    expect(p.today).toBe(2);
    expect(p.remaining).toBe(28);
    expect(p.done).toBe(false);
  });

  it("calls a channel done once the target is met, and does not go past full", () => {
    const touches = Array.from({ length: 35 }, () => touch({ channelId: "c1" }));
    const [p] = progressFor([channel({ id: "c1", dailyTarget: 30 })], touches, TODAY);
    expect(p.done).toBe(true);
    expect(p.remaining).toBe(0);
    expect(p.fraction).toBe(1);
  });

  it("has no daily rhythm for a channel with no target", () => {
    // A paid ad is set up once, not chipped at every morning, and showing it
    // as 0/0 failing every day trains people to ignore the whole screen.
    const [p] = progressFor([channel({ id: "c1", dailyTarget: null })], [], TODAY);
    expect(p.fraction).toBeNull();
    expect(p.remaining).toBeNull();
    expect(p.done).toBe(false);
  });

  it("leaves out channels somebody has switched off", () => {
    expect(progressFor([channel({ id: "c1", active: false })], [], TODAY)).toEqual([]);
  });

  it("orders by the order somebody arranged them in", () => {
    const channels = [
      channel({ id: "late", name: "Paid ads", sortOrder: 70 }),
      channel({ id: "early", name: "Cold calling", sortOrder: 10 }),
    ];
    expect(progressFor(channels, [], TODAY).map((p) => p.channel.id)).toEqual(["early", "late"]);
  });
});

describe("resultsFor", () => {
  const channels = [channel({ id: "c1" }), channel({ id: "c2", key: "cold_dm", name: "Cold DM" })];

  it("separates dialling from landing", () => {
    // Attempts say how much work happened. Booked says whether it worked.
    const touches = [
      touch({ channelId: "c1", outcome: "attempted" }),
      touch({ channelId: "c1", outcome: "reached" }),
      touch({ channelId: "c1", outcome: "booked" }),
      touch({ channelId: "c1", outcome: "not_interested" }),
    ];
    const [c1] = resultsFor(channels, touches);
    expect(c1).toMatchObject({ attempts: 4, reached: 3, booked: 1, bookedPer100: 25 });
  });

  it("closes against people actually spoken to, not everyone dialled", () => {
    const touches = [
      touch({ channelId: "c1", outcome: "attempted" }),
      touch({ channelId: "c1", outcome: "attempted" }),
      touch({ channelId: "c1", outcome: "reached" }),
      touch({ channelId: "c1", outcome: "booked" }),
    ];
    expect(resultsFor(channels, touches)[0].closeRate).toBe(50);
  });

  it("counts a name given by somebody who was never going to buy", () => {
    // The entire argument for working the parts of the county that are not
    // our market. Logged as "not interested" it would be invisible.
    const touches = [
      touch({ channelId: "c1", outcome: "referral_received" }),
      touch({ channelId: "c1", outcome: "not_interested" }),
    ];
    const [c1] = resultsFor(channels, touches);
    expect(c1.referrals).toBe(1);
    expect(c1.reached).toBe(2);
  });

  it("keeps a channel nobody has worked, at zero", () => {
    // A channel that vanishes when it goes untouched is one nobody notices
    // they have stopped doing.
    const results = resultsFor(channels, [touch({ channelId: "c1" })]);
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ attempts: 0, booked: 0, referrals: 0, bookedPer100: null, closeRate: null });
  });

  it("says nothing rather than dividing by zero", () => {
    const touches = [touch({ channelId: "c1", outcome: "attempted" })];
    expect(resultsFor(channels, touches)[0].closeRate).toBeNull();
  });
});

describe("summariseDay", () => {
  it("adds up the day's work against the day's targets", () => {
    const channels = [channel({ id: "c1", dailyTarget: 30 }), channel({ id: "c2", dailyTarget: 10 })];
    const touches = [
      ...Array.from({ length: 30 }, () => touch({ channelId: "c1" })),
      touch({ channelId: "c2", outcome: "booked" }),
    ];
    const summary = summariseDay(progressFor(channels, touches, TODAY), touches, TODAY);
    expect(summary).toEqual({
      logged: 31,
      target: 40,
      booked: 1,
      channelsDone: 1,
      channelsWithTarget: 2,
    });
  });

  it("ignores channels with no target when counting how many are done", () => {
    const channels = [channel({ id: "c1", dailyTarget: null })];
    const summary = summariseDay(progressFor(channels, [], TODAY), [], TODAY);
    expect(summary.channelsWithTarget).toBe(0);
    expect(summary.target).toBe(0);
  });

  it("counts yesterday's work as yesterday's", () => {
    const touches = [touch({ channelId: "c1", day: "2026-08-18" })];
    const summary = summariseDay(progressFor([channel({ id: "c1" })], touches, TODAY), touches, TODAY);
    expect(summary.logged).toBe(0);
  });
});
