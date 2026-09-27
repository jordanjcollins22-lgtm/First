import { describe, expect, it } from "vitest";

import { fitView, layoutLot, parseParcel, pickFootprint, pickFront, pointInRing, streetOf, type LngLat } from "./lot-map";

// A made-up lot: about 40 m wide and 60 m deep, the street to the south.
const LAT = 39.5;
const LNG = -76.35;
const dLng = (m: number) => m / (Math.cos((LAT * Math.PI) / 180) * 111320);
const dLat = (m: number) => m / 110574;
const at = (east: number, north: number): LngLat => [LNG + dLng(east), LAT + dLat(north)];
const lot: LngLat[] = [at(-20, 0), at(20, 0), at(20, 60), at(-20, 60), at(-20, 0)];
const house: LngLat[] = [at(-8, 15), at(8, 15), at(8, 27), at(-8, 27), at(-8, 15)];
const shed: LngLat[] = [at(10, 50), at(14, 50), at(14, 54), at(10, 54), at(10, 50)];

const rings = (...r: LngLat[][]) => ({ features: r.map((ring) => ({ geometry: { rings: [ring] } })) });

describe("reading the county", () => {
  it("reads the parcel ring and its size", () => {
    const parcel = parseParcel({ features: [{ attributes: { "Shape.STArea()": 25830, ST_SQ_FT: 2100 }, geometry: { rings: [lot] } }] });
    expect(parcel?.ring).toHaveLength(5);
    expect(parcel?.lotSqft).toBe(25830);
    expect(parcel?.structureSqft).toBe(2100);
    expect(parseParcel({ features: [] })).toBeNull();
  });

  it("takes the footprint under the pin, and otherwise the biggest on the lot", () => {
    expect(pickFootprint(rings(shed, house), at(0, 20), lot)).toEqual(house);
    expect(pickFootprint(rings(shed, house), null, lot)).toEqual(house);
    expect(pointInRing(at(0, 20), house)).toBe(true);
  });

  it("splits an address into the number and the street", () => {
    expect(streetOf("415 Harrington Road, Bel Air, Maryland 21015")).toEqual({ number: 415, name: "HARRINGTON" });
    expect(streetOf("3d Neptune Drive, Joppa")).toEqual({ number: 3, name: "NEPTUNE" });
    expect(streetOf("Somewhere")).toEqual({ number: null, name: null });
  });
});

describe("which way is the front", () => {
  const road = (name: string, from: number, to: number, path: LngLat[]) => ({
    attributes: { NAME: name, STREETNAME: `${name} RD`, FR_ADD_L: from, TO_ADD_L: to },
    geometry: { paths: [path] },
  });
  const southStreet = road("MAPLE", 400, 430, [at(-100, -8), at(100, -8)]);
  const northStreet = road("OAK", 100, 130, [at(-100, 70), at(100, 70)]);
  const lane = road("ALLEY", 415, 419, [at(-60, 30), at(-25, 30)]);

  it("faces the street it is numbered on, not the nearest one", () => {
    const front = pickFront({ features: [northStreet, southStreet] }, at(0, 21), { number: 415, name: "MAPLE" });
    expect(front?.road).toBe("MAPLE RD");
    expect(front!.point[1]).toBeLessThan(LAT);
  });

  it("faces a private lane that carries the house number", () => {
    const front = pickFront({ features: [southStreet, lane] }, at(0, 21), { number: 415, name: "MAPLE" });
    expect(front?.road).toBe("ALLEY RD");
  });
});

describe("drawing it", () => {
  const data = { ring: lot, footprint: house, front: at(0, -8), frontRoad: "MAPLE RD", lotSqft: 25830, structureSqft: 2100 };

  it("fits the lot in the picture", () => {
    const view = fitView(lot, 640, 440);
    expect(view.zoom).toBeGreaterThan(17);
    expect(view.zoom).toBeLessThanOrEqual(20);
  });

  it("puts the front yard between the house and the street, and the back behind it", () => {
    const layout = layoutLot(data, 640, 440);
    const houseTop = Math.min(...layout.house!.map((p) => p[1]));
    const houseBottom = Math.max(...layout.house!.map((p) => p[1]));
    // North is up, so the street to the south is lower on the picture.
    const frontNearEdge = Math.min(...layout.regions.front[0].map((p) => p[1]));
    const backNearEdge = Math.max(...layout.regions.back[0].map((p) => p[1]));
    expect(frontNearEdge).toBeCloseTo(houseBottom, 0);
    expect(backNearEdge).toBeCloseTo(houseTop, 0);
    expect(layout.regions.sides).toHaveLength(2);
    expect(layout.frontLabel?.at[1]).toBeGreaterThan(houseBottom);
  });

  it("turns the front a quarter at a time when the client says it is wrong", () => {
    const straight = layoutLot(data, 640, 440, 0).regions.front[0];
    const turned = layoutLot(data, 640, 440, 1).regions.front[0];
    expect(turned).not.toEqual(straight);
    expect(layoutLot(data, 640, 440, 4).regions.front[0]).toEqual(straight);
  });

  it("still draws a lot with no footprint and no road", () => {
    const layout = layoutLot({ ...data, footprint: null, front: null, frontRoad: null }, 640, 440);
    expect(layout.house).toBeNull();
    expect(layout.regions.front[0]).toHaveLength(4);
  });
});
