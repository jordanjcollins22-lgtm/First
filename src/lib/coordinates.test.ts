import { describe, expect, it } from "vitest";

import {
  feetBetween,
  formatCoordinates,
  NOTABLE_DRIFT_FEET,
  parseCoordinates,
} from "@/lib/coordinates";

/** A house on a cul-de-sac in Harford County, which is the case this is for. */
const HOUSE = { lat: 39.512345, lng: -76.345678 };

function point(raw: string) {
  const parsed = parseCoordinates(raw);
  if (!parsed.ok) throw new Error(`expected a point from ${raw}: ${parsed.message}`);
  return parsed.point;
}

describe("parseCoordinates", () => {
  it("reads the plain pair everything writes", () => {
    expect(point("39.512345, -76.345678")).toEqual(HOUSE);
  });

  it("reads a pair somebody typed without the comma", () => {
    expect(point("39.512345 -76.345678")).toEqual(HOUSE);
  });

  it("reads degrees, minutes and seconds off a compass app", () => {
    const read = point("39°30'44.4\"N 76°20'44.4\"W");
    expect(read.lat).toBeCloseTo(39.5123, 3);
    expect(read.lng).toBeCloseTo(-76.3457, 3);
  });

  it("reads decimal degrees signed by a letter", () => {
    const read = point("39.512345 N, 76.345678 W");
    expect(read).toEqual(HOUSE);
  });

  it("reads a dropped pin out of a Google Maps link", () => {
    expect(point("https://maps.google.com/?q=39.512345,-76.345678")).toEqual(HOUSE);
  });

  it("prefers the pin over the map centre in a long Google link", () => {
    // The @ part is wherever the map happened to be sitting; !3d!4d is the pin.
    const read = point(
      "https://www.google.com/maps/place/X/@39.4,-76.2,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d39.512345!4d-76.345678"
    );
    expect(read).toEqual(HOUSE);
  });

  it("reads an Apple Maps share link", () => {
    expect(point("https://maps.apple.com/?ll=39.512345,-76.345678&q=Dropped%20Pin")).toEqual(HOUSE);
  });

  it("says what to do about a shortened link instead of failing at it", () => {
    // The fix is one tap and nobody guesses it from "could not read that".
    const parsed = parseCoordinates("https://maps.app.goo.gl/abc123");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/shortened/i);
  });

  it("rounds to about four inches rather than keeping a fake precision", () => {
    expect(point("39.5123456789, -76.3456789012")).toEqual({ lat: 39.512346, lng: -76.345679 });
  });

  it("turns down a GPS that has not fixed yet", () => {
    // Zero, zero is what an empty reading looks like, and it is in the Atlantic.
    const parsed = parseCoordinates("0, 0");
    expect(parsed.ok).toBe(false);
  });

  it("turns down numbers outside the range coordinates come in", () => {
    expect(parseCoordinates("120, -76").ok).toBe(false);
    expect(parseCoordinates("39, -400").ok).toBe(false);
  });

  it("turns down text with no numbers in it", () => {
    expect(parseCoordinates("the house on the left").ok).toBe(false);
    expect(parseCoordinates("").ok).toBe(false);
  });

  it("takes a swapped pair but says so out loud", () => {
    // Saving it silently drops the job in the Labrador Sea, where nobody
    // notices until a crew is sent.
    const parsed = parseCoordinates("-76.345678, 39.512345");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.warning).toMatch(/wrong way round/i);
  });

  it("says nothing about a location that is where it should be", () => {
    const parsed = parseCoordinates("39.512345, -76.345678");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.warning).toBeNull();
  });

  it("queries a location a long way from where this business works", () => {
    const parsed = parseCoordinates("-33.86, 151.2");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.warning).toBeTruthy();
  });
});

describe("feetBetween", () => {
  it("is nothing between a point and itself", () => {
    expect(feetBetween(HOUSE, HOUSE)).toBe(0);
  });

  it("measures a lot's length about right", () => {
    // A thousandth of a degree of latitude is roughly 364 feet.
    expect(feetBetween(HOUSE, { ...HOUSE, lat: HOUSE.lat + 0.001 })).toBeCloseTo(364, -1);
  });

  it("narrows a degree of longitude at this latitude", () => {
    // Longitude lines converge, so the same decimal is a shorter distance.
    const north = feetBetween(HOUSE, { ...HOUSE, lat: HOUSE.lat + 0.001 });
    const east = feetBetween(HOUSE, { ...HOUSE, lng: HOUSE.lng + 0.001 });
    expect(east).toBeLessThan(north);
  });

  it("reads a whole cul-de-sac as further than a lot", () => {
    // The case this exists for: the address placed at the mouth of the court
    // and the house at the end of it.
    const mouth = { lat: 39.5115, lng: -76.3455 };
    expect(feetBetween(HOUSE, mouth)).toBeGreaterThan(NOTABLE_DRIFT_FEET);
  });
});

describe("formatCoordinates", () => {
  it("writes them the way everything else does", () => {
    expect(formatCoordinates(HOUSE)).toBe("39.512345, -76.345678");
  });
});
