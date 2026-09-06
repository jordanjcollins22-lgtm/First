import { describe, expect, it } from "vitest";

import {
  housesToFeatures,
  parseBbox,
  pointsToFeatures,
  stageColorExpression,
  stageForMap,
  type MapHouse,
  type MapPoint,
} from "@/lib/house-geojson";

const house = (over: Partial<MapHouse> = {}): MapHouse => ({
  id: "h1",
  address: "1550 Swearingen Drive, Bel Air, Maryland 21014",
  lat: 39.5359,
  lng: -76.3483,
  stage: "client",
  contacts: ["Jordan"],
  customerId: "c1",
  countyPin: true,
  ...over,
});

describe("housesToFeatures", () => {
  it("draws a house where it is, coloured by how far it has got with us", () => {
    const [feature] = housesToFeatures([house()]);
    expect(feature.geometry.coordinates).toEqual([-76.3483, 39.5359]);
    expect(feature.properties.color).toBe("#22c55e");
    expect(feature.properties.contacts).toBe("Jordan");
  });

  it("does not draw a house that has no pin yet", () => {
    // 0,0 is "waiting for the county's pin", not a place in the Gulf of Guinea.
    expect(housesToFeatures([house({ lat: 0, lng: 0 })])).toHaveLength(0);
  });
});

describe("parseBbox", () => {
  it("reads a viewport", () => {
    const params = new URLSearchParams({ minLat: "39.5", minLng: "-76.4", maxLat: "39.6", maxLng: "-76.3" });
    expect(parseBbox(params)).toEqual({ minLat: 39.5, minLng: -76.4, maxLat: 39.6, maxLng: -76.3 });
  });

  it("refuses a viewport that is missing, inside out, or off the planet", () => {
    expect(parseBbox(new URLSearchParams({ minLat: "1" }))).toBeNull();
    expect(parseBbox(new URLSearchParams({ minLat: "2", minLng: "0", maxLat: "1", maxLng: "1" }))).toBeNull();
    expect(parseBbox(new URLSearchParams({ minLat: "0", minLng: "0", maxLat: "95", maxLng: "1" }))).toBeNull();
  });
});

describe("pointsToFeatures", () => {
  it("turns bare points into features carrying their stage, ownership and recent sale", () => {
    const points: MapPoint[] = [[-76.3483, 39.5359, 4, 2, 1], [-76.3, 39.5, 0]];
    const features = pointsToFeatures(points);
    expect(features).toHaveLength(2);
    expect(features[0].geometry.coordinates).toEqual([-76.3483, 39.5359]);
    expect(features[0].properties).toEqual({ s: 4, o: 2, r: 1 });
    // A point from before ownership was known carries zeros for it.
    expect(features[1].properties).toEqual({ s: 0, o: 0, r: 0 });
  });

  it("drops a point that is not one", () => {
    expect(pointsToFeatures([[NaN, 1, 0] as MapPoint, [1] as unknown as MapPoint])).toHaveLength(0);
  });
});

describe("stageColorExpression", () => {
  it("maps every rank to its stage colour, with untouched as the fallback", () => {
    const expression = stageColorExpression();
    expect(expression[0]).toBe("match");
    expect(expression).toContain("#22c55e");
    expect(expression[expression.length - 1]).toBe("#94a3b8");
  });
});

describe("stageForMap", () => {
  it("counts a known contact with nothing recorded as spoken to", () => {
    expect(stageForMap([], true)).toBe("spoken_to");
    expect(stageForMap([], false)).toBe("untouched");
  });

  it("never lowers a stage the events earned", () => {
    expect(stageForMap([{ kind: "client", at: "2026-01-01" }], true)).toBe("client");
  });
});
