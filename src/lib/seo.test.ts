import { describe, expect, it } from "vitest";

import { gbpWeeklyPlan, missingTownPages, seasonalServices, seasonOf, townCoverage, townFromAddress } from "@/lib/seo";

describe("townFromAddress", () => {
  it("reads the town from the second part of an address", () => {
    expect(townFromAddress("12 Main St, Bel Air, MD 21014")).toBe("Bel Air");
    expect(townFromAddress("1 Union Ave, HAVRE DE GRACE, MD")).toBe("Havre de Grace");
  });

  it("is null for a suite, a coordinate or nothing", () => {
    expect(townFromAddress("1 Rd, Suite 214, Bel Air")).toBeNull();
    expect(townFromAddress("39.5, -76.174210")).toBeNull();
    expect(townFromAddress("1 Rd")).toBeNull();
    expect(townFromAddress(null)).toBeNull();
  });
});

describe("townCoverage", () => {
  const jobs = [
    { address: "1 A St, Bel Air, MD", completed: true },
    { address: "2 B St, bel air, MD", completed: false },
    { address: "3 C St, Edgewood, MD", completed: false },
    { address: "4 D St, Edgewood, MD", completed: true },
    { address: "5 E St, Pasadena, MD", completed: false },
  ];

  it("counts jobs per town, most first, and marks which have pages", () => {
    const rows = townCoverage(jobs, ["Bel Air", "Fallston"]);
    expect(rows[0]).toEqual({ town: "Bel Air", jobs: 2, done: 1, hasPage: true });
    expect(rows.find((r) => r.town === "Edgewood")).toEqual({ town: "Edgewood", jobs: 2, done: 1, hasPage: false });
  });

  it("names towns with two or more jobs and no page", () => {
    expect(missingTownPages(townCoverage(jobs, ["Bel Air"]))).toEqual(["Edgewood"]);
  });
});

describe("gbpWeeklyPlan", () => {
  const services = ["Lawn mowing", "Aeration & overseeding", "Mulch & bed refresh", "Fall cleanup & leaf removal", "Snow removal & salting"];

  it("knows the season and the services that sell in it", () => {
    expect(seasonOf(new Date("2026-11-08T00:00:00Z"))).toBe("fall");
    expect(seasonOf(new Date("2026-12-20T00:00:00Z"))).toBe("winter");
    expect(seasonalServices(services, "winter")).toEqual(["Snow removal & salting"]);
    expect(seasonalServices(["Grading"], "winter")).toEqual(["Grading"]);
  });

  it("plans one post a week from Monday, rotating kind, town and service", () => {
    const plan = gbpWeeklyPlan({ from: new Date("2026-11-08T12:00:00Z"), towns: ["Bel Air", "Abingdon"], services, businessName: "JS Landscaping" });
    expect(plan).toHaveLength(4);
    expect(plan[0].weekOf).toBe("2026-11-02");
    expect(plan[1].weekOf).toBe("2026-11-09");
    expect(new Set(plan.map((w) => w.post.kind)).size).toBe(4);
    expect(plan.every((w) => /Bel Air|Abingdon/.test(w.post.body))).toBe(true);
    expect(plan[0].checklist.length).toBeGreaterThan(0);
    expect(plan.find((w) => w.post.kind === "offer")?.post.title).toMatch(/^Book now: .+ this fall$/);
  });

  it("gives the same week the same post whenever it is read", () => {
    const a = gbpWeeklyPlan({ from: new Date("2026-11-10T00:00:00Z"), towns: ["Joppa"], services, businessName: "X", weeks: 1 });
    const b = gbpWeeklyPlan({ from: new Date("2026-11-04T00:00:00Z"), towns: ["Joppa"], services, businessName: "X", weeks: 2 });
    expect(b[1]).toEqual(a[0]);
  });
});
