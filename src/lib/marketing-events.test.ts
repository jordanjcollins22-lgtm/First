import { describe, expect, it } from "vitest";

import {
  completionWork,
  hasBeforeAfterPair,
  idempotencyKey,
  isMarketingEvent,
  marketingEligiblePhotos,
  windowStart,
} from "./marketing-events";

describe("one opportunity per trip", () => {
  it("puts a whole week in one window", () => {
    // Tuesday and Thursday of the same week: somebody is going there once.
    expect(windowStart("2026-09-08T09:00:00.000Z")).toBe("2026-09-07");
    expect(windowStart("2026-09-10T17:00:00.000Z")).toBe("2026-09-07");
  });

  it("puts Sunday in the week that has just ended, not the one starting", () => {
    expect(windowStart("2026-09-13T11:00:00.000Z")).toBe("2026-09-07");
    expect(windowStart("2026-09-14T11:00:00.000Z")).toBe("2026-09-14");
  });

  it("gives two deliveries of one event the same key", () => {
    const a = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-08T09:00:00.000Z" });
    const b = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-10T21:00:00.000Z" });
    expect(a).toBe(b);
  });

  it("separates a genuinely different trip", () => {
    const thisWeek = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-08T09:00:00.000Z" });
    const nextWeek = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-15T09:00:00.000Z" });
    expect(thisWeek).not.toBe(nextWeek);
  });

  it("separates the kinds, because they mean different things on the street", () => {
    const booked = idempotencyKey({ kind: "evaluation_booked", jobId: "j1", occurredAt: "2026-09-08T09:00:00.000Z" });
    const done = idempotencyKey({ kind: "job_completed", jobId: "j1", occurredAt: "2026-09-08T09:00:00.000Z" });
    expect(booked).not.toBe(done);
  });

  it("does not fall over on a date it cannot read", () => {
    expect(windowStart("not a date")).toBe("1970-01-01");
  });
});

describe("which photos may be used", () => {
  const photo = (phase: string | null, marketingApproved = false) => ({ phase, marketingApproved });

  it("takes the before and the after", () => {
    const kept = marketingEligiblePhotos([photo("evaluation"), photo("prework"), photo("after")]);
    expect(kept).toHaveLength(3);
  });

  it("never takes a damage or issue photo on its own", () => {
    expect(marketingEligiblePhotos([photo("issue")])).toEqual([]);
  });

  it("takes an issue photo only where somebody deliberately marked it", () => {
    expect(marketingEligiblePhotos([photo("issue", true)])).toHaveLength(1);
  });

  it("leaves out a half-finished progress shot", () => {
    expect(marketingEligiblePhotos([photo("progress")])).toEqual([]);
  });

  it("leaves out a photo with no phase at all rather than guessing", () => {
    expect(marketingEligiblePhotos([photo(null)])).toEqual([]);
  });

  it("needs both halves for a before-and-after", () => {
    expect(hasBeforeAfterPair([photo("after")])).toBe(false);
    expect(hasBeforeAfterPair([photo("evaluation")])).toBe(false);
    expect(hasBeforeAfterPair([photo("evaluation"), photo("after")])).toBe(true);
  });

  it("does not make a pair out of an issue photo and an after photo", () => {
    expect(hasBeforeAfterPair([photo("issue"), photo("after")])).toBe(false);
  });
});

describe("what finishing a job makes possible", () => {
  const photo = (phase: string) => ({ phase });

  it("offers only what the job can actually support", () => {
    expect(
      completionWork({ photos: [photo("evaluation"), photo("after")], hasClientContact: true, zoneId: "z1" })
    ).toEqual({ contentCandidate: true, reviewRequest: true, neighbourhoodOpportunity: true });
  });

  it("does not ask for a post from a job with no after photo", () => {
    const work = completionWork({ photos: [photo("evaluation")], hasClientContact: true, zoneId: "z1" });
    expect(work.contentCandidate).toBe(false);
  });

  it("does not ask for a review from a client with no way to reach them", () => {
    const work = completionWork({ photos: [], hasClientContact: false, zoneId: "z1" });
    expect(work.reviewRequest).toBe(false);
  });

  it("does not offer a neighbourhood the map does not know about", () => {
    const work = completionWork({ photos: [], hasClientContact: true, zoneId: null });
    expect(work.neighbourhoodOpportunity).toBe(false);
  });
});

describe("what a kind is allowed to be", () => {
  it("refuses anything not in the list", () => {
    expect(isMarketingEvent("job_completed")).toBe(true);
    expect(isMarketingEvent("job_cancelled")).toBe(false);
  });
});
