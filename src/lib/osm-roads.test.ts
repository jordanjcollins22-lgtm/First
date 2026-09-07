import { describe, expect, it } from "vitest";

import { HARFORD_BBOX, overpassQuery, parseOverpass, tilesFor } from "./osm-roads";

describe("tiles", () => {
  it("cuts the county into tiles that meet at their edges", () => {
    const tiles = tilesFor(HARFORD_BBOX, 4, 4);
    expect(tiles).toHaveLength(16);
    expect(tiles[0].south).toBe(HARFORD_BBOX.south);
    expect(tiles[15].north).toBe(HARFORD_BBOX.north);
    expect(tiles[15].east).toBe(HARFORD_BBOX.east);
    expect(tiles[1].west).toBe(tiles[0].east);
  });
  it("asks Overpass for the ways a person can use", () => {
    const q = overpassQuery(tilesFor(HARFORD_BBOX, 1, 1)[0]);
    expect(q).toContain('way["highway"~"^(residential|');
    expect(q).toContain("footway");
    expect(q).not.toContain("motorway");
    expect(q).toContain("out geom;");
  });
});

describe("parseOverpass", () => {
  it("turns each way into straight segments in metres, skipping what is not a road", () => {
    const rows = parseOverpass({
      elements: [
        { type: "way", id: 1, tags: { highway: "residential", name: "Crafton Rd" }, geometry: [{ lat: 39.5, lon: -76.35 }, { lat: 39.5005, lon: -76.35 }, { lat: 39.501, lon: -76.351 }] },
        { type: "way", id: 2, tags: { highway: "motorway" }, geometry: [{ lat: 39.5, lon: -76.35 }, { lat: 39.6, lon: -76.35 }] },
        { type: "node", id: 3 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe(1);
    expect(rows[0][1]).toBe("residential");
    expect(rows[0][2]).toBe("Crafton Rd");
    // Half a thousandth of a degree of latitude is about 55 m.
    expect(Math.abs(rows[0][6] - rows[0][4])).toBeCloseTo(55.3, 0);
    expect(parseOverpass(null)).toEqual([]);
  });
});
