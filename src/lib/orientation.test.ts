import { describe, expect, it } from "vitest";

import {
  autoBearing,
  bearingBetween,
  describeHeading,
  mapBearingForFrontDown,
  metresBetween,
  normalizeDegrees,
  pickFrontingRoad,
  type RoadCandidate,
} from "@/lib/orientation";

const house = { lat: 39.5359, lng: -76.3483 }; // Bel Air, MD

/** A point roughly `metres` away from the house on the given compass bearing. */
function offset(bearing: number, metres: number) {
  const R = 6_371_000;
  const δ = metres / R;
  const θ = (bearing * Math.PI) / 180;
  const φ1 = (house.lat * Math.PI) / 180;
  const λ1 = (house.lng * Math.PI) / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

describe("bearings", () => {
  it("reads due north as 0", () => {
    expect(bearingBetween(house, offset(0, 40))).toBeCloseTo(0, 1);
  });

  it("reads due east as 90", () => {
    expect(bearingBetween(house, offset(90, 40))).toBeCloseTo(90, 1);
  });

  it("reads due south as 180", () => {
    expect(bearingBetween(house, offset(180, 40))).toBeCloseTo(180, 1);
  });

  it("reads due west as 270", () => {
    expect(bearingBetween(house, offset(270, 40))).toBeCloseTo(270, 1);
  });

  it("wraps rather than going negative", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
  });
});

describe("turning the map", () => {
  it("leaves a south-facing house alone", () => {
    // Street due south means the front already points at the bottom of a
    // north-up photo, so there is nothing to turn.
    expect(mapBearingForFrontDown(180)).toBe(0);
  });

  it("turns a north-facing house all the way round", () => {
    expect(mapBearingForFrontDown(0)).toBe(180);
  });

  it("turns an east-facing house a quarter turn", () => {
    expect(mapBearingForFrontDown(90)).toBe(270);
  });
});

describe("which road is the front", () => {
  const street = (distance: number, roadClass: string | null, bearing = 180): RoadCandidate => ({
    ...offset(bearing, distance),
    distanceMetres: distance,
    roadClass,
  });

  it("takes the nearest proper street", () => {
    const picked = pickFrontingRoad([street(60, "street"), street(25, "street", 0)]);
    expect(picked?.distanceMetres).toBe(25);
  });

  it("does not let a footpath behind the garden turn the picture round", () => {
    // The alley at 18m is closer than the street at 30m, but a house does not
    // front onto an alley.
    const picked = pickFrontingRoad([street(18, "path", 0), street(30, "street", 180)]);
    expect(picked?.roadClass).toBe("street");
  });

  it("believes the path when it is dramatically closer", () => {
    const picked = pickFrontingRoad([street(5, "path", 0), street(90, "street", 180)]);
    expect(picked?.roadClass).toBe("path");
  });

  it("takes what it has when nothing is a proper street", () => {
    expect(pickFrontingRoad([street(40, "path")])?.roadClass).toBe("path");
    expect(pickFrontingRoad([street(40, null)])?.roadClass).toBeNull();
  });

  it("says nothing when there is nothing", () => {
    expect(pickFrontingRoad([])).toBeNull();
  });
});

describe("the automatic guess", () => {
  it("puts a street to the north at the bottom of the frame", () => {
    const bearing = autoBearing(house, [
      { ...offset(0, 30), distanceMetres: 30, roadClass: "street" },
    ]);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("leaves a street to the south as it is", () => {
    const bearing = autoBearing(house, [
      { ...offset(180, 30), distanceMetres: 30, roadClass: "street" },
    ]);
    expect(bearing! % 360).toBeCloseTo(0, 0);
  });

  it("gives up rather than guessing with nothing to go on", () => {
    expect(autoBearing(house, [])).toBeNull();
  });

  it("gives up when the road point sits on the house", () => {
    // Zero distance makes the bearing meaningless, and a meaningless turn is
    // worse than no turn — the evaluator is told to do it by hand.
    expect(
      autoBearing(house, [{ ...house, distanceMetres: 0, roadClass: "street" }])
    ).toBeNull();
  });
});

describe("saying it out loud", () => {
  it("names the compass points", () => {
    expect(describeHeading(0)).toBe("north");
    expect(describeHeading(90)).toBe("east");
    expect(describeHeading(181)).toBe("south");
    expect(describeHeading(315)).toBe("north-west");
  });
});

describe("distance", () => {
  it("measures a known offset", () => {
    expect(metresBetween(house, offset(45, 100))).toBeCloseTo(100, 0);
  });
});
