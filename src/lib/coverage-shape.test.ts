import { describe, expect, it } from "vitest";

import { clientDoors, parseCoverage, shapeFor, warmDoors } from "@/lib/coverage-shape";

describe("shapeFor", () => {
  it("turns a drawn polygon into an open ring", () => {
    const shape = shapeFor("polygon", {
      points: [
        { lat: 39.53, lng: -76.36 },
        { lat: 39.53, lng: -76.33 },
        { lat: 39.545, lng: -76.33 },
      ],
    });
    expect(shape?.zips).toBeNull();
    expect(shape?.ring).toHaveLength(3);
    expect(shape?.ring?.[0]).toEqual([-76.36, 39.53]);
  });

  it("turns a circle round an address into a ring too", () => {
    const shape = shapeFor("point_radius", { lat: 39.5359, lng: -76.3483, radius_miles: 0.5 });
    expect(shape?.ring?.length ?? 0).toBeGreaterThan(8);
  });

  it("keeps a ZIP list as ZIPs, five digits each", () => {
    expect(shapeFor("zip_list", { zips: ["21014-1234", " 21015", "bad"] })).toEqual({ ring: null, zips: ["21014", "21015"] });
    expect(shapeFor("zip_list", { zips: [] })).toBeNull();
  });

  it("is nothing for a shape too small to be one", () => {
    expect(shapeFor("polygon", { points: [{ lat: 1, lng: 1 }] })).toBeNull();
  });
});

describe("parseCoverage", () => {
  it("reads the database's answer, with zeros for anything missing", () => {
    const coverage = parseCoverage({
      total: 120,
      by_stage: { untouched: 100, spoken_to: 10, client: 8, job_completed: 2 },
      do_not_contact: 3,
      to_hang: 117,
      first_time: 90,
      print_run: [{ design: 1, count: 90 }, { design: 2, count: 27 }],
    });
    expect(coverage.total).toBe(120);
    expect(coverage.byStage.evaluation).toBe(0);
    expect(clientDoors(coverage)).toBe(10);
    expect(warmDoors(coverage)).toBe(10);
    expect(coverage.printRun[1]).toEqual({ design: 2, count: 27 });
  });

  it("copes with nothing at all", () => {
    expect(parseCoverage(null).total).toBe(0);
    expect(parseCoverage(undefined).printRun).toEqual([]);
  });
});
