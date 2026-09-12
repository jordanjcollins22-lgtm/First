import { describe, expect, it } from "vitest";

import {
  attribute,
  costPerJob,
  CREDIT_WINDOW_DAYS,
  healthOf,
  totalsByChannel,
  type Attribution,
  type JobAttributionFacts,
} from "./attribution";

const facts = (over: Partial<JobAttributionFacts> = {}): JobAttributionFacts => ({
  jobId: "j1",
  sourceWaveId: null,
  sourceWaveChannel: null,
  referredByProfileId: null,
  hadEarlierCompletedJob: false,
  cameThroughBookingLink: false,
  campaignsInRange: [],
  addressOnMap: true,
  ...over,
});

const wave = (id: string, label: string) => ({
  waveId: id,
  channel: "door_hanger" as const,
  deliveredAt: "2026-07-01",
  label,
});

describe("what brought the job in", () => {
  it("takes what was recorded at the time over anything worked out", () => {
    const a = attribute(
      facts({
        sourceWaveId: "w1",
        sourceWaveChannel: "eddm",
        campaignsInRange: [wave("w2", "Chestnut hangers")],
      })
    );
    expect(a.channel).toBe("eddm");
    expect(a.confidence).toBe("recorded");
    expect(a.waveId).toBe("w1");
  });

  it("credits a referral to the person named", () => {
    const a = attribute(facts({ referredByProfileId: "p1" }));
    expect(a.channel).toBe("referral");
    expect(a.confidence).toBe("recorded");
  });

  it("calls a returning client a repeat rather than a campaign win", () => {
    const a = attribute(facts({ hadEarlierCompletedJob: true, campaignsInRange: [wave("w1", "Oak hangers")] }));
    expect(a.channel).toBe("repeat");
  });

  it("credits a booking link to inbound", () => {
    expect(attribute(facts({ cameThroughBookingLink: true })).channel).toBe("inbound");
  });
});

describe("the one inference, and its limits", () => {
  it("credits the only campaign that could have done it, and says so", () => {
    const a = attribute(facts({ campaignsInRange: [wave("w1", "Chestnut hangers")] }));
    expect(a.channel).toBe("door_hanger");
    expect(a.confidence).toBe("inferred");
    expect(a.because).toBe(
      `Chestnut hangers was the only campaign to reach this address in the ${CREDIT_WINDOW_DAYS} days before.`
    );
  });

  it("never picks between two campaigns", () => {
    // The most common way an attribution report becomes a lie.
    const a = attribute(facts({ campaignsInRange: [wave("w1", "A"), wave("w2", "B")] }));
    expect(a.channel).toBeNull();
    expect(a.confidence).toBe("unknown");
    expect(a.waveId).toBeNull();
  });

  it("distinguishes 'could not tell' from 'nothing was recorded'", () => {
    expect(attribute(facts({ campaignsInRange: [wave("a", "A"), wave("b", "B")] })).confidence).toBe("unknown");
    expect(attribute(facts()).confidence).toBe("unattributed");
  });

  it("says plainly when it could not even look", () => {
    const a = attribute(facts({ addressOnMap: false }));
    expect(a.confidence).toBe("unattributed");
    expect(a.because).toContain("not on the map");
  });

  it("always gives a reason, including for the absences", () => {
    for (const f of [facts(), facts({ addressOnMap: false }), facts({ campaignsInRange: [wave("a", "A"), wave("b", "B")] })]) {
      expect(attribute(f).because.length).toBeGreaterThan(0);
    }
  });
});

describe("adding it up", () => {
  const row = (attribution: Attribution, revenueCents: number) => ({ attribution, revenueCents });
  const rec = (channel: Attribution["channel"]): Attribution => ({
    channel,
    confidence: "recorded",
    waveId: null,
    because: "x",
  });
  const inf = (channel: Attribution["channel"]): Attribution => ({
    channel,
    confidence: "inferred",
    waveId: "w",
    because: "x",
  });
  const absent = (confidence: "unknown" | "unattributed"): Attribution => ({
    channel: null,
    confidence,
    waveId: null,
    because: "x",
  });

  it("keeps the two absences out of the channels entirely", () => {
    const totals = totalsByChannel([
      row(rec("door_hanger"), 100_000),
      row(absent("unknown"), 50_000),
      row(absent("unattributed"), 25_000),
    ]);
    expect(totals.channels).toHaveLength(1);
    expect(totals.unknown).toEqual({ jobs: 1, revenueCents: 50_000 });
    expect(totals.unattributed).toEqual({ jobs: 1, revenueCents: 25_000 });
    expect(totals.totalRevenueCents).toBe(175_000);
  });

  it("shows how much of a channel rests on the inference", () => {
    const totals = totalsByChannel([row(rec("door_hanger"), 100_000), row(inf("door_hanger"), 40_000)]);
    const hangers = totals.channels[0];
    expect(hangers.jobs).toBe(2);
    expect(hangers.revenueCents).toBe(140_000);
    expect(hangers.inferredJobs).toBe(1);
    expect(hangers.inferredRevenueCents).toBe(40_000);
  });

  it("sorts the channels by the money", () => {
    const totals = totalsByChannel([row(rec("flyer"), 10_000), row(rec("door_hanger"), 90_000)]);
    expect(totals.channels.map((c) => c.channel)).toEqual(["door_hanger", "flyer"]);
  });
});

describe("whether the report can be spent against", () => {
  const totals = (over: Partial<ReturnType<typeof totalsByChannel>>) => ({
    channels: [],
    unknown: { jobs: 0, revenueCents: 0 },
    unattributed: { jobs: 0, revenueCents: 0 },
    totalJobs: 10,
    totalRevenueCents: 0,
    ...over,
  });

  it("says nothing when the attribution is good", () => {
    expect(healthOf(totals({ channels: [{ channel: "door_hanger", revenueCents: 1, jobs: 10, inferredJobs: 0, inferredRevenueCents: 0 }] }))).toEqual([]);
  });

  it("calls a recording problem a recording problem", () => {
    const notes = healthOf(totals({ unattributed: { jobs: 5, revenueCents: 0 } }));
    expect(notes[0]).toContain("50% of jobs have no source recorded");
    expect(notes[0]).toContain("ask on the call");
  });

  it("calls overlapping campaigns what they are, rather than a recording problem", () => {
    const notes = healthOf(totals({ unknown: { jobs: 4, revenueCents: 0 } }));
    expect(notes[0]).toContain("campaigns overlapped");
    expect(notes[0]).toContain("Staggering");
  });

  it("flags a report resting mostly on the inference", () => {
    const notes = healthOf(
      totals({ channels: [{ channel: "door_hanger", revenueCents: 1, jobs: 10, inferredJobs: 4, inferredRevenueCents: 1 }] })
    );
    expect(notes[0]).toContain("40% rests on one campaign having been the only one in range");
  });

  it("says so plainly when there is no work to talk about", () => {
    expect(healthOf(totals({ totalJobs: 0 }))).toEqual(["No sold work in this period."]);
  });
});

describe("cost per job", () => {
  it("is null when the spend was never recorded", () => {
    // A cost per job computed from a zero cost reads as a spectacular success.
    expect(costPerJob(null, 4)).toBeNull();
  });

  it("is null when nothing was won, rather than infinity", () => {
    expect(costPerJob(50_000, 0)).toBeNull();
  });

  it("is the money over the jobs otherwise", () => {
    expect(costPerJob(50_000, 4)).toBe(12_500);
  });
});
