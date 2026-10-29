import { describe, expect, it } from "vitest";

import { MAX_TAPS, parsePreEvalTaps, readStoredTaps } from "./pre-eval";

const property = { lng: -76.6122, lat: 39.2904 };

describe("parsePreEvalTaps", () => {
  it("accepts taps on and around the property", () => {
    const taps = [
      [-76.6122, 39.2904],
      [-76.6125, 39.2906],
    ];
    expect(parsePreEvalTaps(taps, property)).toEqual(taps);
  });

  it("accepts no taps", () => {
    expect(parsePreEvalTaps([], property)).toEqual([]);
  });

  it("rejects taps far from the property", () => {
    // ~1.1 km north
    expect(parsePreEvalTaps([[-76.6122, 39.3004]], property)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parsePreEvalTaps("nope", property)).toBeNull();
    expect(parsePreEvalTaps([[1]], property)).toBeNull();
    expect(parsePreEvalTaps([["-76.6", "39.2"]], property)).toBeNull();
    expect(parsePreEvalTaps([[NaN, 39.29]], property)).toBeNull();
  });

  it("rejects too many taps", () => {
    const taps = Array.from({ length: MAX_TAPS + 1 }, () => [property.lng, property.lat]);
    expect(parsePreEvalTaps(taps, property)).toBeNull();
  });
});

describe("readStoredTaps", () => {
  it("keeps well-formed taps and drops the rest", () => {
    expect(readStoredTaps([[1, 2], "x", [3], [4, 5]])).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(readStoredTaps(null)).toEqual([]);
  });
});
