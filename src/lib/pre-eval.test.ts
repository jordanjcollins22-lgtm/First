import { describe, expect, it } from "vitest";

import { MAX_SPOTS, parsePreEvalSpots, readStoredSpots, UNSURE_SERVICE } from "./pre-eval";

const preEvalId = "11111111-2222-3333-4444-555555555555";
const photo = `${preEvalId}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`;
const ctx = {
  preEvalId,
  property: { lng: -76.6122, lat: 39.2904 },
  serviceIds: new Set(["mulch", "weeds"]),
};
const spot = (over: Record<string, unknown> = {}) => ({
  lng: -76.6122,
  lat: 39.2904,
  services: ["mulch"],
  photos: [photo],
  ...over,
});

describe("parsePreEvalSpots", () => {
  it("accepts spots on the property with services and photos", () => {
    const spots = [spot(), spot({ lng: -76.6125, services: ["weeds", UNSURE_SERVICE], photos: [] })];
    expect(parsePreEvalSpots(spots, ctx)).toEqual(spots);
  });

  it("dedupes services", () => {
    expect(parsePreEvalSpots([spot({ services: ["mulch", "mulch"] })], ctx)?.[0].services).toEqual(["mulch"]);
  });

  it("rejects spots far from the property", () => {
    // ~1.1 km north
    expect(parsePreEvalSpots([spot({ lat: 39.3004 })], ctx)).toBeNull();
  });

  it("rejects a spot with no service or an unknown one", () => {
    expect(parsePreEvalSpots([spot({ services: [] })], ctx)).toBeNull();
    expect(parsePreEvalSpots([spot({ services: ["roofing"] })], ctx)).toBeNull();
  });

  it("rejects photos that weren't uploaded for this pre-eval", () => {
    const other = "99999999-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";
    expect(parsePreEvalSpots([spot({ photos: [other] })], ctx)).toBeNull();
    expect(parsePreEvalSpots([spot({ photos: [`${preEvalId}/../x.jpg`] })], ctx)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parsePreEvalSpots("nope", ctx)).toBeNull();
    expect(parsePreEvalSpots([null], ctx)).toBeNull();
    expect(parsePreEvalSpots([spot({ lng: "-76.6" })], ctx)).toBeNull();
    expect(parsePreEvalSpots([spot({ lat: NaN })], ctx)).toBeNull();
  });

  it("rejects too many spots", () => {
    expect(parsePreEvalSpots(Array.from({ length: MAX_SPOTS + 1 }, () => spot()), ctx)).toBeNull();
  });
});

describe("readStoredSpots", () => {
  it("keeps well-formed spots and drops the rest", () => {
    expect(readStoredSpots([spot(), "x", { lng: 1 }])).toEqual([spot()]);
    expect(readStoredSpots(null)).toEqual([]);
  });
});
