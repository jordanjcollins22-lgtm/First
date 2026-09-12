import { describe, expect, it } from "vitest";

import {
  centreOf,
  closedLabel,
  defaultDirection,
  hasPlace,
  nextDirection,
  SORTS,
  sortEntries,
  type MapEntry,
} from "@/lib/map-index";

function job(title: string, closedAt: string | null, size: number | null = null): MapEntry {
  return { kind: "job", id: title, title, subtitle: "", closedAt, size, lat: 39.5, lng: -76.3 };
}

function route(title: string, size: number): MapEntry {
  return { kind: "route", id: title, title, subtitle: "", closedAt: null, size, lat: 39.5, lng: -76.3 };
}

const MIXED = [
  route("21014 C005", 900),
  job("Trellis Lane", "2026-09-01T00:00:00Z", 350),
  route("21009 R012", 1400),
  job("Red Pump Road", "2026-09-08T00:00:00Z", 5400),
  job("Crestwood Drive", "2026-08-01T00:00:00Z", 1200),
];

describe("the order of the list", () => {
  it("puts finished work above the routes, always", () => {
    // Different kinds of thing. A list that shuffles them together is one
    // nobody can scan.
    for (const sort of SORTS) {
      const kinds = sortEntries(MIXED, sort.key, defaultDirection(sort.key)).map((e) => e.kind);
      expect(kinds.indexOf("route"), sort.key).toBeGreaterThan(kinds.lastIndexOf("job"));
    }
  });

  it("leads with the job we finished most recently", () => {
    expect(sortEntries(MIXED, "recent", "desc")[0].title).toBe("Red Pump Road");
  });

  it("turns round when the same sort is clicked again", () => {
    expect(sortEntries(MIXED, "recent", "asc")[0].title).toBe("Crestwood Drive");
  });

  it("sorts routes by size under newest, since a route has no date", () => {
    const routes = sortEntries(MIXED, "recent", "desc").filter((e) => e.kind === "route");
    expect(routes.map((r) => r.title)).toEqual(["21009 R012", "21014 C005"]);
  });

  it("sorts by name when asked", () => {
    const jobs = sortEntries(MIXED, "name", "asc").filter((e) => e.kind === "job");
    expect(jobs.map((j) => j.title)).toEqual(["Crestwood Drive", "Red Pump Road", "Trellis Lane"]);
  });

  it("sorts by size when asked, biggest first", () => {
    const jobs = sortEntries(MIXED, "size", "desc").filter((e) => e.kind === "job");
    expect(jobs[0].title).toBe("Red Pump Road");
  });

  it("puts anything with no date last rather than in a random spot", () => {
    const undated = job("No date", null);
    const sorted = sortEntries([undated, job("Dated", "2026-09-01T00:00:00Z")], "recent", "desc");
    expect(sorted[sorted.length - 1].title).toBe("No date");
  });

  it("keeps every row, whatever the sort", () => {
    for (const sort of SORTS) {
      expect(sortEntries(MIXED, sort.key, "desc")).toHaveLength(MIXED.length);
    }
  });

  it("copes with an empty list", () => {
    expect(sortEntries([], "recent", "desc")).toEqual([]);
  });
});

describe("clicking a sort", () => {
  it("switches to it, facing the way that reads best", () => {
    expect(nextDirection("recent", "name", "desc")).toBe("asc");
    expect(nextDirection("name", "size", "asc")).toBe("desc");
  });

  it("turns the current one round instead of doing nothing", () => {
    expect(nextDirection("recent", "recent", "desc")).toBe("asc");
    expect(nextDirection("recent", "recent", "asc")).toBe("desc");
  });

  it("reads newest and biggest downwards, a name upwards", () => {
    expect(defaultDirection("recent")).toBe("desc");
    expect(defaultDirection("size")).toBe("desc");
    expect(defaultDirection("name")).toBe("asc");
  });
});

describe("whether a row can be opened", () => {
  it("needs somewhere to fly to", () => {
    expect(hasPlace(job("a", null))).toBe(true);
    expect(hasPlace({ ...job("a", null), lat: null })).toBe(false);
    expect(hasPlace({ ...job("a", null), lng: Number.NaN })).toBe(false);
  });
});

describe("the middle of a route", () => {
  it("is the middle of the box round it", () => {
    // The box rather than the average of the points, so a route with a dense
    // cul-de-sac at one end still centres on the whole of itself.
    const ring: [number, number][] = [
      [-76.4, 39.4],
      [-76.2, 39.6],
      [-76.2, 39.4],
      [-76.4, 39.6],
    ];
    const centre = centreOf(ring)!;
    expect(centre.lat).toBeCloseTo(39.5, 9);
    expect(centre.lng).toBeCloseTo(-76.3, 9);
  });

  it("ignores a point that is not a point", () => {
    const ring = [[-76.4, 39.4], [Number.NaN, 39.6]] as [number, number][];
    const centre = centreOf(ring)!;
    expect(centre.lat).toBeCloseTo(39.4, 9);
    expect(centre.lng).toBeCloseTo(-76.4, 9);
  });

  it("is nothing for nothing", () => {
    expect(centreOf([])).toBeNull();
  });
});

describe("saying how long ago", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("says today, yesterday, and then days", () => {
    expect(closedLabel("2026-09-10T09:00:00Z", now)).toBe("Today");
    expect(closedLabel("2026-09-09T09:00:00Z", now)).toBe("Yesterday");
    expect(closedLabel("2026-09-07T09:00:00Z", now)).toBe("3 days ago");
  });

  it("moves to weeks and months rather than counting to ninety", () => {
    expect(closedLabel("2026-09-01T12:00:00Z", now)).toBe("Last week");
    expect(closedLabel("2026-08-10T12:00:00Z", now)).toBe("4 weeks ago");
    expect(closedLabel("2026-05-10T12:00:00Z", now)).toBe("4 months ago");
  });

  it("says nothing when there is no date", () => {
    expect(closedLabel(null, now)).toBeNull();
    expect(closedLabel("not a date", now)).toBeNull();
  });
});
