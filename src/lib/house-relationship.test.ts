import { describe, expect, it } from "vitest";

import {
  displayStage,
  hasCooled,
  latestEvent,
  rankOf,
  zoneStats,
  type HouseEvent,
} from "@/lib/house-relationship";

const at = (iso: string) => `${iso}T12:00:00.000Z`;

const spoke: HouseEvent = { kind: "spoken_to", at: at("2026-01-10") };
const evaluated: HouseEvent = { kind: "evaluation", at: at("2026-02-01") };
const quoted: HouseEvent = { kind: "proposal", at: at("2026-02-08") };
const paid: HouseEvent = { kind: "client", at: at("2026-03-01") };
const finished: HouseEvent = { kind: "job_completed", at: at("2026-04-01") };

describe("displayStage", () => {
  it("is untouched for a house nothing has happened to", () => {
    expect(displayStage([])).toBe("untouched");
  });

  it("is the furthest a house has ever got", () => {
    expect(displayStage([spoke, evaluated, quoted])).toBe("proposal");
  });

  it("does not care what order the events arrive in", () => {
    expect(displayStage([finished, spoke, paid])).toBe("job_completed");
  });

  it("keeps a former client a client after they later decline", () => {
    // The case that makes this a projection and not a column. Overwriting
    // would send somebody to knock on a door that has already paid us.
    const declinedLater: HouseEvent = { kind: "spoken_to", at: at("2026-08-01") };
    expect(displayStage([paid, declinedLater])).toBe("client");
  });

  it("counts a single conversation", () => {
    expect(displayStage([spoke])).toBe("spoken_to");
  });
});

describe("rankOf", () => {
  it("orders the stages the way the business reads them", () => {
    expect(rankOf("untouched")).toBeLessThan(rankOf("spoken_to"));
    expect(rankOf("spoken_to")).toBeLessThan(rankOf("evaluation"));
    expect(rankOf("evaluation")).toBeLessThan(rankOf("proposal"));
    expect(rankOf("proposal")).toBeLessThan(rankOf("client"));
    expect(rankOf("client")).toBeLessThan(rankOf("job_completed"));
  });
});

describe("latestEvent", () => {
  it("is the most recent thing, which is not the same as the furthest", () => {
    const declinedLater: HouseEvent = { kind: "spoken_to", at: at("2026-08-01") };
    expect(latestEvent([paid, declinedLater])).toBe(declinedLater);
    expect(displayStage([paid, declinedLater])).toBe("client");
  });

  it("is nothing for a house with no history", () => {
    expect(latestEvent([])).toBeNull();
  });
});

describe("hasCooled", () => {
  it("is true for a client whose last contact went backwards", () => {
    const declinedLater: HouseEvent = { kind: "spoken_to", at: at("2026-08-01") };
    expect(hasCooled([paid, declinedLater])).toBe(true);
  });

  it("is false while the story is still going forwards", () => {
    expect(hasCooled([spoke, evaluated, quoted, paid])).toBe(false);
  });

  it("is false for a house with no history to go backwards from", () => {
    expect(hasCooled([])).toBe(false);
  });
});

describe("zoneStats", () => {
  /** The example from the brief: a thirty-two home court. */
  const court = [
    ...Array.from({ length: 2 }, () => [paid]),
    ...Array.from({ length: 4 }, () => [evaluated]),
    ...Array.from({ length: 26 }, () => [] as HouseEvent[]),
  ];

  it("counts the court the way somebody standing in it would", () => {
    const stats = zoneStats(court);
    expect(stats.houses).toBe(32);
    expect(stats.clients).toBe(2);
    expect(stats.byStage.evaluation).toBe(4);
    expect(stats.untouched).toBe(26);
  });

  it("works out density from clients, not from anybody we merely spoke to", () => {
    expect(zoneStats(court).densityPercent).toBe(6.25);
  });

  it("counts every house exactly once", () => {
    const stats = zoneStats(court);
    const counted = Object.values(stats.byStage).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(stats.houses);
  });

  it("counts a finished job as a client for density", () => {
    const stats = zoneStats([[finished], [paid], []]);
    expect(stats.clients).toBe(2);
  });

  it("separates the engaged from the bought", () => {
    const stats = zoneStats([[spoke], [evaluated], [quoted], [paid], []]);
    expect(stats.engaged).toBe(3);
    expect(stats.clients).toBe(1);
    expect(stats.untouched).toBe(1);
  });

  it("is all zeroes for a zone with no houses, rather than dividing by none", () => {
    const stats = zoneStats([]);
    expect(stats.houses).toBe(0);
    expect(stats.densityPercent).toBe(0);
  });

  it("is a hundred percent when every house has bought", () => {
    expect(zoneStats([[paid], [finished]]).densityPercent).toBe(100);
  });

  it("keeps density to two decimals rather than a long float", () => {
    // One in three is 33.333...; a map badge should not say that.
    expect(zoneStats([[paid], [], []]).densityPercent).toBe(33.33);
  });
});
