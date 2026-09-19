import { describe, expect, it } from "vitest";

import {
  DEFAULT_RADIUS_MILES,
  LOCATION_RADIUS_MILES,
  NIGHTLY_BUDGET,
  planGrowth,
  rankSeeds,
  type SeedCandidate,
} from "@/lib/prospecting";

const TODAY = new Date("2026-08-17T12:00:00Z");
const TARGET = 5000;

function seed(overrides: Partial<SeedCandidate> = {}): SeedCandidate {
  return { id: "s", lat: 39.5, lng: -76.3, label: "somewhere", wonValue: null, date: null, ...overrides };
}

describe("rankSeeds", () => {
  it("puts a big recent job ahead of a small old one", () => {
    const ranked = rankSeeds(
      [
        seed({ id: "small-old", wonValue: 2000, date: "2023-01-01" }),
        seed({ id: "big-recent", wonValue: 15000, date: "2026-07-20" }),
      ],
      TARGET,
      TODAY
    );
    expect(ranked[0].id).toBe("big-recent");
  });

  it("prefers a won job to one that never closed", () => {
    const ranked = rankSeeds(
      [seed({ id: "unsold", date: "2026-08-01" }), seed({ id: "sold", wonValue: 6000, date: "2026-08-01" })],
      TARGET,
      TODAY
    );
    expect(ranked[0].id).toBe("sold");
    expect(ranked[0].kind).toBe("won_job");
  });

  it("prefers the more recent of two equal jobs", () => {
    const ranked = rankSeeds(
      [
        seed({ id: "older", wonValue: 8000, date: "2025-01-01" }),
        seed({ id: "newer", wonValue: 8000, date: "2026-08-01" }),
      ],
      TARGET,
      TODAY
    );
    expect(ranked[0].id).toBe("newer");
  });

  it("pushes work older than two years down the list", () => {
    const ranked = rankSeeds(
      [
        seed({ id: "ancient", wonValue: 20000, date: "2019-01-01" }),
        seed({ id: "modest-recent", wonValue: 5200, date: "2026-08-10" }),
      ],
      TARGET,
      TODAY
    );
    expect(ranked[0].id).toBe("modest-recent");
  });
});

describe("planGrowth", () => {
  const jobs = [
    seed({ id: "a", wonValue: 9000, date: "2026-08-01" }),
    seed({ id: "b", wonValue: 7000, date: "2026-07-01" }),
    seed({ id: "c", wonValue: 6000, date: "2026-06-01" }),
    seed({ id: "d", wonValue: 5500, date: "2026-05-01" }),
  ];
  const locations = [seed({ id: "yard", label: "The Shop" })];

  it("grows around finished work, tightly", () => {
    const plan = planGrowth(jobs, locations, TARGET, NIGHTLY_BUDGET, TODAY);
    expect(plan.radiusMiles).toBe(DEFAULT_RADIUS_MILES);
    expect(plan.seeds.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("stays inside the nightly budget", () => {
    const plan = planGrowth(jobs, locations, TARGET, NIGHTLY_BUDGET, TODAY);
    expect(plan.seeds).toHaveLength(NIGHTLY_BUDGET.maxSeeds);
    expect(plan.perSeed).toBe(NIGHTLY_BUDGET.perSeed);
  });

  it("falls back to the yard, and searches wider, when nothing has finished", () => {
    const plan = planGrowth([], locations, TARGET, NIGHTLY_BUDGET, TODAY);
    expect(plan.seeds[0].id).toBe("yard");
    expect(plan.seeds[0].kind).toBe("location");
    expect(plan.radiusMiles).toBe(LOCATION_RADIUS_MILES);
  });

  it("plans nothing when there is nowhere to grow from", () => {
    expect(planGrowth([], [], TARGET, NIGHTLY_BUDGET, TODAY).seeds).toEqual([]);
  });
});
