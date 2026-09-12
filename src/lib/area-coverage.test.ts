import { describe, expect, it } from "vitest";

import { addressInArea, coverageFor, describeCoverage, type AreaAddress } from "@/lib/area-coverage";
import type { AttractorGeometry } from "@/types/domain";

/** A mile-wide circle around a point in Harford County. */
const CIRCLE = { type: "point_radius" as const, geometry: { lat: 39.5, lng: -76.3, radius_miles: 1 } };

function addr(o: Partial<AreaAddress> = {}): AreaAddress {
  return { lat: 39.5, lng: -76.3, zip: "21014", source: "prospect", ...o };
}

describe("addressInArea", () => {
  it("counts a point inside the circle", () => {
    expect(addressInArea(addr(), CIRCLE.type, CIRCLE.geometry)).toBe(true);
  });

  it("leaves out a point beyond the radius", () => {
    // Roughly seven miles north — well outside a one-mile circle.
    expect(addressInArea(addr({ lat: 39.6 }), CIRCLE.type, CIRCLE.geometry)).toBe(false);
  });

  it("cannot place an address the geocoder never resolved", () => {
    // Counting it anyway would inflate the figure people order boxes against.
    expect(addressInArea(addr({ lat: null, lng: null }), CIRCLE.type, CIRCLE.geometry)).toBe(false);
  });

  it("matches a zip list on the zip, since there is no shape to be inside", () => {
    const geometry = { zips: ["21014", "21015"] } as unknown as AttractorGeometry;
    expect(addressInArea(addr({ zip: "21015" }), "zip_list", geometry)).toBe(true);
    expect(addressInArea(addr({ zip: "21050" }), "zip_list", geometry)).toBe(false);
  });

  it("matches a ZIP+4 against a plain zip in the list", () => {
    const geometry = { zips: ["21014"] } as unknown as AttractorGeometry;
    expect(addressInArea(addr({ zip: "21014-1234" }), "zip_list", geometry)).toBe(true);
  });

  it("does not count an address with no zip against a zip list", () => {
    const geometry = { zips: ["21014"] } as unknown as AttractorGeometry;
    expect(addressInArea(addr({ zip: null }), "zip_list", geometry)).toBe(false);
  });

  it("counts a point inside a drawn polygon", () => {
    const geometry = {
      points: [
        { lat: 39.4, lng: -76.4 },
        { lat: 39.6, lng: -76.4 },
        { lat: 39.6, lng: -76.2 },
        { lat: 39.4, lng: -76.2 },
      ],
    } as unknown as AttractorGeometry;
    expect(addressInArea(addr(), "polygon", geometry)).toBe(true);
    expect(addressInArea(addr({ lat: 39.9 }), "polygon", geometry)).toBe(false);
  });

  it("says no rather than guessing on malformed geometry", () => {
    expect(addressInArea(addr(), "polygon", { points: [] } as unknown as AttractorGeometry)).toBe(false);
  });
});

describe("coverageFor", () => {
  it("splits the count so somebody can act on it", () => {
    const addresses = [
      addr(),
      addr({ lat: 39.501 }),
      addr({ lat: 39.502, source: "client" }),
      addr({ lat: 39.9 }), // outside
    ];
    expect(coverageFor(CIRCLE.type, CIRCLE.geometry, addresses)).toMatchObject({
      total: 3,
      prospects: 2,
      clients: 1,
      toHang: 3,
    });
  });

  it("subtracts do-not-contact rather than dropping them", () => {
    // They are still a door on that street; the walker needs to know to skip
    // it rather than wonder why the numbers do not add up.
    const addresses = [addr(), addr({ lat: 39.501, doNotContact: true })];
    const coverage = coverageFor(CIRCLE.type, CIRCLE.geometry, addresses);
    expect(coverage.total).toBe(2);
    expect(coverage.doNotContact).toBe(1);
    expect(coverage.toHang).toBe(1);
  });

  it("flags a count made only of our own clients as a floor", () => {
    // Our client book is a fraction of any street by definition.
    const coverage = coverageFor(CIRCLE.type, CIRCLE.geometry, [addr({ source: "client" })]);
    expect(coverage.countIsFloor).toBe(true);
  });

  it("stops flagging once real parcels are in the area", () => {
    const coverage = coverageFor(CIRCLE.type, CIRCLE.geometry, [addr(), addr({ source: "client" })]);
    expect(coverage.countIsFloor).toBe(false);
  });

  it("returns zeroes for an area with nothing in it", () => {
    expect(coverageFor(CIRCLE.type, CIRCLE.geometry, [])).toMatchObject({ total: 0, toHang: 0 });
  });
});

describe("describeCoverage", () => {
  it("sends somebody to import parcels when there is nothing to count", () => {
    expect(describeCoverage(coverageFor(CIRCLE.type, CIRCLE.geometry, []))).toContain("Import the parcels");
  });

  it("warns that a client-only count is not the street", () => {
    const coverage = coverageFor(CIRCLE.type, CIRCLE.geometry, [addr({ source: "client" })]);
    expect(describeCoverage(coverage)).toContain("will be higher");
  });

  it("says where a real count came from, and what to skip", () => {
    const addresses = [addr(), addr({ lat: 39.501, source: "client" }), addr({ lat: 39.502, doNotContact: true })];
    const text = describeCoverage(coverageFor(CIRCLE.type, CIRCLE.geometry, addresses));
    expect(text).toContain("2 imported parcels");
    expect(text).toContain("Skip 1");
  });
});
