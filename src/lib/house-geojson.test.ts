import { describe, expect, it } from "vitest";

import { housesToFeatures, parseBbox, type MapHouse } from "@/lib/house-geojson";

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
