import { describe, expect, it } from "vitest";

import {
  calibrateAll,
  calibrateService,
  CLOSE_ENOUGH,
  costOfBeingWrongCents,
  ENOUGH_JOBS,
  headline,
  median,
  type WorkSample,
} from "./calibration";

const sample = (quoted: number, actual: number, i: number, serviceTypeId = "mowing"): WorkSample => ({
  jobId: `j${i}`,
  serviceTypeId,
  quotedHours: quoted,
  actualHours: actual,
  completedAt: "2026-06-01",
});

const many = (quoted: number, actual: number, n = ENOUGH_JOBS, id = "mowing") =>
  Array.from({ length: n }, (_, i) => sample(quoted, actual, i, id));

describe("the median", () => {
  it("is the middle one", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("splits the difference on an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is null for nothing", () => {
    expect(median([])).toBeNull();
  });

  it("is not dragged about by one disaster", () => {
    // The whole reason it is the median: one job where the van broke down.
    expect(median([4, 4, 4, 4, 40])).toBe(4);
  });
});

describe("what a service actually takes", () => {
  it("refuses to speak from too few jobs", () => {
    const c = calibrateService("mowing", many(4, 8, ENOUGH_JOBS - 1));
    expect(c.verdict).toBe("not_enough");
    expect(c.ratio).toBeNull();
    expect(c.says).toBe("4 finished jobs with clocked time. 1 more and this can be answered.");
  });

  it("says so plainly when there is nothing at all", () => {
    expect(calibrateService("mowing", []).says).toContain("No finished job with clocked time yet");
  });

  it("leaves a quote alone when it is close enough", () => {
    const c = calibrateService("mowing", many(4, 4.4));
    expect(c.verdict).toBe("about_right");
    expect(c.suggestedHours).toBeNull();
    expect(Math.abs(c.ratio! - 1)).toBeLessThanOrEqual(CLOSE_ENOUGH);
  });

  it("names an under-quote and what the jobs actually took", () => {
    const c = calibrateService("mowing", many(4, 6));
    expect(c.verdict).toBe("under_quoted");
    expect(c.suggestedHours).toBe(6);
    expect(c.says).toBe(
      "Under-quoted by 50%: 5 finished jobs took a median 6.0 crew-hours against 4.0 quoted."
    );
  });

  it("names an over-quote too, because that loses work", () => {
    const c = calibrateService("mowing", many(8, 4));
    expect(c.verdict).toBe("over_quoted");
    expect(c.suggestedHours).toBe(4);
    expect(c.says).toContain("Over-quoted by 50%");
  });

  it("suggests the measured hours rather than a ratio applied to the quote", () => {
    // The number the jobs actually produced, not arithmetic on the old guess.
    expect(calibrateService("mowing", many(4, 6)).suggestedHours).toBe(6);
  });

  it("drops jobs with no quote instead of calling them infinitely under-quoted", () => {
    const mixed = [...many(4, 6), sample(0, 9, 99)];
    expect(calibrateService("mowing", mixed).jobs).toBe(ENOUGH_JOBS);
  });

  it("never suggests anything for a service it cannot judge", () => {
    expect(calibrateService("mowing", many(4, 40, 2)).suggestedHours).toBeNull();
  });
});

describe("the list", () => {
  it("puts the services with a case to answer first", () => {
    const all = calibrateAll([
      ...many(4, 4, ENOUGH_JOBS, "about-right"),
      ...many(4, 8, ENOUGH_JOBS, "under"),
      ...many(4, 4, 2, "unknown"),
    ]);
    expect(all.map((c) => c.serviceTypeId)).toEqual(["under", "about-right", "unknown"]);
  });
});

describe("what being wrong costs", () => {
  it("is null when the crew cost was never set", () => {
    expect(costOfBeingWrongCents(calibrateService("mowing", many(4, 6)), null)).toBeNull();
  });

  it("is the extra hours at the crew rate", () => {
    // Two hours over, at $40 an hour.
    expect(costOfBeingWrongCents(calibrateService("mowing", many(4, 6)), 4000)).toBe(8000);
  });

  it("is negative when the quote is above what it takes", () => {
    expect(costOfBeingWrongCents(calibrateService("mowing", many(8, 4)), 4000)).toBe(-16000);
  });
});

describe("the one sentence at the top", () => {
  it("names the service costing the most", () => {
    const all = calibrateAll([...many(4, 5, ENOUGH_JOBS, "small"), ...many(10, 20, ENOUGH_JOBS, "big")]);
    expect(headline(all, 4000)).toContain("big is the one to fix");
  });

  it("says so when everything measurable is fine", () => {
    expect(headline(calibrateAll(many(4, 4)), 4000)).toBe(
      "Every service with enough finished jobs to judge is quoted about right (1 of them)."
    );
  });

  it("does not pretend to know when nothing can be judged", () => {
    expect(headline(calibrateAll(many(4, 4, 2)), 4000)).toBe(
      "Not enough finished jobs with clocked time yet to judge any service."
    );
  });
});
