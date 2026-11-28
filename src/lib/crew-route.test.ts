import { describe, expect, it } from "vitest";

import { hazardLines, milesBetween, pickVisit, routeByNearest } from "./crew-route";

// Real spots in Harford County.
const FALLSTON = { jobId: "roger", lat: 39.5148, lng: -76.4108 };
const FOREST_HILL = { jobId: "vincent", lat: 39.5832, lng: -76.3877 };
const BEL_AIR = { jobId: "lisa", lat: 39.5359, lng: -76.3483 };
const HAVRE = { jobId: "marge", lat: 39.5493, lng: -76.0916 };
const NO_PIN = { jobId: "nopin", lat: null, lng: null };

const ids = (s: { jobId: string }[]) => s.map((x) => x.jobId);

describe("routeByNearest", () => {
  it("starts at the first stop, then always goes to the closest one left", () => {
    expect(ids(routeByNearest([FALLSTON, HAVRE, FOREST_HILL, BEL_AIR]))).toEqual(["roger", "lisa", "vincent", "marge"]);
  });

  it("re-routes from wherever the crew finished last", () => {
    expect(ids(routeByNearest([FALLSTON, HAVRE, FOREST_HILL, BEL_AIR], ["marge"]))).toEqual(["marge", "lisa", "roger", "vincent"]);
  });

  it("puts a job with no pin last", () => {
    expect(ids(routeByNearest([FALLSTON, NO_PIN, HAVRE, BEL_AIR]))).toEqual(["roger", "lisa", "marge", "nopin"]);
  });

  it("leaves one stop alone", () => {
    expect(ids(routeByNearest([HAVRE]))).toEqual(["marge"]);
  });

  it("measures miles", () => {
    expect(milesBetween(FALLSTON, HAVRE)).toBeGreaterThan(15);
    expect(milesBetween(FALLSTON, HAVRE)).toBeLessThan(20);
  });
});

describe("hazardLines", () => {
  it("pulls the warning out of what's left", () => {
    expect(hazardLines("Finish shrub removal. Gas line under a bush: bring the proper tools.")).toEqual([
      "Gas line under a bush: bring the proper tools.",
    ]);
  });

  it("finds nothing in plain work", () => {
    expect(hazardLines("Topsoil and backfill around the wall", null)).toEqual([]);
  });
});

describe("pickVisit", () => {
  const v = (starts_on: string, ends_on = starts_on) => ({ starts_on, ends_on });
  it("takes today's visit, else the next one, else the last", () => {
    expect(pickVisit([v("2026-11-20"), v("2026-11-27", "2026-11-29"), v("2026-12-02")], "2026-11-28")?.starts_on).toBe("2026-11-27");
    expect(pickVisit([v("2026-11-20"), v("2026-12-02")], "2026-11-28")?.starts_on).toBe("2026-12-02");
    expect(pickVisit([v("2026-11-20")], "2026-11-28")?.starts_on).toBe("2026-11-20");
    expect(pickVisit([], "2026-11-28")).toBeNull();
  });
});

describe("hazardLines on a plain place name", () => {
  it("does not flag a line just for saying where the work is", () => {
    expect(hazardLines("Remove the plant at the back slope. Gas line under a bush.")).toEqual(["Gas line under a bush."]);
  });
});
