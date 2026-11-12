import { describe, expect, it } from "vitest";

import {
  LEAD_FINDER_WEEKLY_COUNT,
  cleanChecks,
  pickWeek,
  propertyPoints,
  rankParcel,
  satelliteLink,
  scoreProspect,
  streetViewUrl,
  suggestedServices,
  tierOf,
  weekOf,
} from "@/lib/lead-finder";
import { seedRows } from "@/lib/lead-finder-view";
import { SEED_PROSPECTS } from "@/lib/lead-finder-seed";

describe("scoreProspect", () => {
  it("is 0 for nothing seen on a small plain lot", () => {
    const r = scoreProspect({}, { category: "commercial", acreage: 0.2, ownerState: "MD" });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("park");
  });

  it("caps each group: satellite 3, Street View 3, reviews 2, property 2", () => {
    const all = { bedsBare: true, lawnStrips: true, bigLot: true, treeCover: true, asphaltWorn: true, weeds: true, staining: true, overgrown: true, reviewComplaints: true };
    const r = scoreProspect(all, { category: "church", acreage: 3, ownerState: "PA" });
    expect(r.byGroup).toEqual({ satellite: 3, streetView: 3, reviews: 2, property: 2 });
    expect(r.score).toBe(10);
    expect(r.tier).toBe("walk_in");
  });

  it("gives property points from the roll: size, curb-appeal type, out-of-state owner", () => {
    expect(propertyPoints({ category: "apartments", acreage: 4, ownerState: "MD" }).points).toBe(2);
    expect(propertyPoints({ category: "commercial", acreage: 0.3, ownerState: "MD", name: "Bel Air Medical Center" }).points).toBe(1);
    expect(propertyPoints({ category: "commercial", acreage: null, ownerState: "VA" }).reasons[0]).toMatch(/VA/);
  });

  it("names services from what was seen", () => {
    const r = scoreProspect({ asphaltWorn: true, staining: true }, { category: "commercial", acreage: 1, ownerState: null });
    expect(r.services).toEqual(["pressure_washing", "sealcoating"]);
    expect(r.score).toBe(3);
  });

  it("ignores keys that are not on the rubric", () => {
    expect(cleanChecks({ bedsBare: true, hacked: true, weeds: false, staining: "yes" })).toEqual({ bedsBare: true });
    expect(cleanChecks(null)).toEqual({});
  });
});

describe("tiers and services", () => {
  it("splits walk-in, letter and park at 7 and 4", () => {
    expect(tierOf(7)).toBe("walk_in");
    expect(tierOf(6)).toBe("letter");
    expect(tierOf(4)).toBe("letter");
    expect(tierOf(3)).toBe("park");
  });

  it("falls back to the type's usual services before anyone looks", () => {
    expect(suggestedServices({}, "hoa", null)).toEqual(["mulch", "mowing", "leaf_cleanup"]);
    expect(suggestedServices({ lawnStrips: true }, "commercial", 2)).toEqual(["mowing"]);
  });
});

describe("the week", () => {
  it("is the Monday, in Eastern time", () => {
    expect(weekOf(new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-09");
    expect(weekOf(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-02"); // still Sunday night in Maryland
    expect(weekOf(new Date("2026-11-16T05:00:00Z"))).toBe("2026-11-16");
  });

  it("tops the list up from the best unseen properties, skipping small lots", () => {
    const all = [
      { id: "a", status: "new", weekOf: "2026-11-09", priority: 1, acreage: 1 },
      { id: "b", status: "new", weekOf: null, priority: 9, acreage: 0.2 },
      { id: "c", status: "new", weekOf: null, priority: 8, acreage: null },
      { id: "d", status: "reviewed", weekOf: null, priority: 10, acreage: 2 },
      { id: "e", status: "new", weekOf: null, priority: 5, acreage: 3 },
      { id: "f", status: "new", weekOf: null, priority: 4, acreage: 3 },
    ];
    const { onList, added } = pickWeek(all, "2026-11-09", 3);
    expect(onList.map((p) => p.id)).toEqual(["a"]);
    expect(added.map((p) => p.id)).toEqual(["c", "e"]);
  });

  it("ranks a hand-picked A above the same property unpicked", () => {
    const base = { category: "commercial" as const, acreage: 1, ownerState: "MD", assessedValue: 500_000 };
    expect(rankParcel({ ...base, seedPriority: "A" })).toBeGreaterThan(rankParcel(base));
  });
});

describe("links", () => {
  it("opens Street View at the point, or searches the address", () => {
    expect(streetViewUrl({ lat: 39.5, lng: -76.4, address: "1 Main St" })).toContain("map_action=pano&viewpoint=39.500000,-76.400000");
    expect(streetViewUrl({ lat: null, lng: null, address: "23 Newport Dr", city: "Forest Hill", zip: "21050" })).toContain("query=23%20Newport%20Dr%2C%20Forest%20Hill%2C%20MD%2021050");
    expect(satelliteLink({ lat: null, lng: null, address: "1 Main St" })).toContain("t=k");
  });
});

describe("seed list", () => {
  it("has the 44 places from the business list, businesses only", () => {
    expect(SEED_PROSPECTS).toHaveLength(44);
    expect(new Set(SEED_PROSPECTS.map((s) => s.key)).size).toBe(44);
    for (const s of SEED_PROSPECTS) expect(["A", "B", "C"]).toContain(s.priority);
  });

  it("makes a sample week of the weekly count, A-list first", () => {
    const rows = seedRows("2026-11-09", LEAD_FINDER_WEEKLY_COUNT);
    expect(rows).toHaveLength(LEAD_FINDER_WEEKLY_COUNT);
    expect(rows.every((r) => r.weekOf === "2026-11-09")).toBe(true);
    expect(rows[0].seedPriority).toBe("A");
  });
});
