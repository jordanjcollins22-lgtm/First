import { describe, expect, it } from "vitest";

import { emptyAnswers } from "@/lib/evaluation-intake";
import type { AreaKey, LngLat } from "@/lib/lot-map";
import {
  answersFromSpots,
  areaForPoint,
  cleanOutline,
  depositCents,
  MAX_OUTLINE_POINTS,
  MAX_SPOTS,
  outlineAreaSqft,
  parseTapSpots,
  readTapSpots,
  type TapSpot,
} from "@/lib/tap-estimate";

const jobId = "11111111-2222-3333-4444-555555555555";
const photo = `${jobId}/intake-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`;
const home: LngLat = [-76.35, 39.53];
const spot = (over: Partial<TapSpot> = {}): TapSpot => ({ lng: home[0], lat: home[1], choices: ["mulch"], photos: [photo], ...over });

// Degrees per foot near home, for drawing shapes of a known size.
const FT_LAT = 1 / 364_000;
const FT_LNG = FT_LAT / Math.cos((home[1] * Math.PI) / 180);
/** A w x h foot rectangle with its corner at home, closed. */
const rect = (w: number, h: number, at: LngLat = home): LngLat[] => [
  at,
  [at[0] + w * FT_LNG, at[1]],
  [at[0] + w * FT_LNG, at[1] + h * FT_LAT],
  [at[0], at[1] + h * FT_LAT],
  at,
];
/** A circle of the given radius in feet, as n points dragged round it (not closed). */
const circlePath = (radiusFt: number, n: number): LngLat[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [home[0] + Math.cos(a) * radiusFt * FT_LNG, home[1] + Math.sin(a) * radiusFt * FT_LAT] as LngLat;
  });

describe("outlineAreaSqft", () => {
  it("measures a drawn shape in square feet", () => {
    expect(outlineAreaSqft(rect(20, 10))).toBeCloseTo(200, -1);
    expect(outlineAreaSqft(rect(100, 50))).toBeCloseTo(5000, -2);
  });

  it("takes the ring open or closed", () => {
    expect(outlineAreaSqft(rect(20, 10).slice(0, -1))).toBeCloseTo(outlineAreaSqft(rect(20, 10))!, 6);
  });

  it("is null for a shape with no honest area", () => {
    expect(outlineAreaSqft(null)).toBeNull();
    expect(outlineAreaSqft([home, [home[0] + 0.0001, home[1]]])).toBeNull();
    // A bow tie crosses itself.
    const bowTie: LngLat[] = [home, [home[0] + 0.0001, home[1] + 0.0001], [home[0] + 0.0001, home[1]], [home[0], home[1] + 0.0001]];
    expect(outlineAreaSqft(bowTie)).toBeNull();
    expect(outlineAreaSqft([home, [NaN, 1], [1, 1]])).toBeNull();
  });
});

describe("cleanOutline", () => {
  it("thins a dragged path to at most the corner limit and closes it, keeping its size", () => {
    const ring = cleanOutline(circlePath(20, 400), home)!;
    expect(ring).not.toBeNull();
    expect(ring.length - 1).toBeLessThanOrEqual(MAX_OUTLINE_POINTS);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // pi * 20^2 = 1257 sq ft; thinning shaves a little off.
    expect(outlineAreaSqft(ring)!).toBeGreaterThan(1200);
    expect(outlineAreaSqft(ring)!).toBeLessThan(1260);
  });

  it("keeps a small bed's shape", () => {
    const ring = cleanOutline(circlePath(3, 200), home)!;
    expect(outlineAreaSqft(ring)!).toBeGreaterThan(25);
  });

  it("refuses slivers, huge shapes, self-crossing paths and shapes away from the house", () => {
    expect(cleanOutline(rect(1, 1), home)).toBeNull();
    expect(cleanOutline(rect(200, 200), home)).toBeNull();
    expect(cleanOutline([home, [home[0] + 0.0001, home[1] + 0.0001], [home[0] + 0.0001, home[1]], [home[0], home[1] + 0.0001]], home)).toBeNull();
    expect(cleanOutline(rect(20, 10, [home[0], home[1] + 0.01]), home)).toBeNull();
    expect(cleanOutline([home, home], home)).toBeNull();
  });
});

describe("depositCents", () => {
  it("is a third, rounded up to a whole dollar", () => {
    expect(depositCents(150_000)).toBe(50_000);
    expect(depositCents(100_000)).toBe(33_400);
    expect(depositCents(0)).toBe(0);
  });
});

describe("parseTapSpots", () => {
  const ctx = { jobId, home };

  it("keeps good spots", () => {
    expect(parseTapSpots([spot(), spot({ choices: ["weeds", "trim"], photos: [] })], ctx)).toHaveLength(2);
  });

  it("dedupes choices and photos", () => {
    expect(parseTapSpots([spot({ choices: ["mulch", "mulch"], photos: [photo, photo] })], ctx)?.[0]).toMatchObject({ choices: ["mulch"], photos: [photo] });
  });

  it("refuses no spots, too many, or a spot with nothing picked", () => {
    expect(parseTapSpots([], ctx)).toBeNull();
    expect(parseTapSpots(Array.from({ length: MAX_SPOTS + 1 }, () => spot()), ctx)).toBeNull();
    expect(parseTapSpots([spot({ choices: [] })], ctx)).toBeNull();
    expect(parseTapSpots([spot({ choices: ["roofing"] })], ctx)).toBeNull();
  });

  it("refuses a spot far from the house", () => {
    // About 1.1 km north.
    expect(parseTapSpots([spot({ lat: home[1] + 0.01 })], ctx)).toBeNull();
  });

  it("refuses photos that aren't this job's form photos", () => {
    expect(parseTapSpots([spot({ photos: ["99999999-2222-3333-4444-555555555555/intake-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"] })], ctx)).toBeNull();
    expect(parseTapSpots([spot({ photos: [`${jobId}/../secret.jpg`] })], ctx)).toBeNull();
  });

  it("keeps an outline drawn round the spot, closed", () => {
    const [parsed] = parseTapSpots([spot({ outline: rect(20, 10).slice(0, -1) })], ctx)!;
    expect(parsed.outline).toEqual(rect(20, 10));
    expect(parseTapSpots([spot()], ctx)![0]).not.toHaveProperty("outline");
  });

  it("drops an outline that can't be measured, keeping the spot", () => {
    for (const outline of [rect(1, 1), rect(200, 200), [home, [home[0] + 0.0001, home[1] + 0.0001], [home[0] + 0.0001, home[1]], [home[0], home[1] + 0.0001]] as LngLat[]]) {
      const parsed = parseTapSpots([spot({ outline })], ctx);
      expect(parsed).toHaveLength(1);
      expect(parsed![0]).not.toHaveProperty("outline");
    }
  });

  it("refuses an outline the page would never send", () => {
    const bad = (outline: unknown) => parseTapSpots([{ ...spot(), outline }], ctx);
    expect(bad("square")).toBeNull();
    expect(bad([home, home])).toBeNull();
    expect(bad(rect(20, 10).map(([x, y]) => [x, String(y)]))).toBeNull();
    expect(bad([...rect(20, 10).slice(0, 3), [Infinity, home[1]]])).toBeNull();
    expect(bad(circlePath(20, MAX_OUTLINE_POINTS + 5))).toBeNull();
    // Drawn off a kilometre away.
    expect(bad(rect(20, 10, [home[0], home[1] + 0.01]))).toBeNull();
  });

  it("refuses junk", () => {
    expect(parseTapSpots("nope", ctx)).toBeNull();
    expect(parseTapSpots([null], ctx)).toBeNull();
    expect(parseTapSpots([{ ...spot(), lng: "-76" }], ctx)).toBeNull();
  });
});

describe("readTapSpots", () => {
  it("drops anything malformed", () => {
    expect(readTapSpots([spot(), "x", { lng: 1 }])).toEqual([spot()]);
    expect(readTapSpots(null)).toEqual([]);
  });

  it("reads an outline back, and drops a broken one", () => {
    expect(readTapSpots([spot({ outline: rect(20, 10) })])[0].outline).toEqual(rect(20, 10));
    expect(readTapSpots([{ ...spot(), outline: [[1, "x"]] }])[0]).not.toHaveProperty("outline");
    expect(readTapSpots([{ ...spot(), outline: [home, home] }])[0]).not.toHaveProperty("outline");
  });
});

describe("areaForPoint", () => {
  const square = (x: number, y: number): LngLat[] => [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
  const regions = { front: [square(0, 0)], back: [square(0, 2)], sides: [square(2, 0)], foundation: [square(0.25, 0.25)], whole: [] } as unknown as Record<AreaKey, LngLat[][]>;

  it("finds the part of the yard, around the house first", () => {
    expect(areaForPoint([0.5, 0.5], regions)).toBe("foundation");
    expect(areaForPoint([0.1, 0.1], regions)).toBe("front");
    expect(areaForPoint([0.5, 2.5], regions)).toBe("back");
    expect(areaForPoint([2.5, 0.5], regions)).toBe("sides");
  });

  it("is null off the lot or with no lot", () => {
    expect(areaForPoint([9, 9], regions)).toBeNull();
    expect(areaForPoint([0.5, 0.5], null)).toBeNull();
  });
});

describe("answersFromSpots", () => {
  it("turns taps into the form's services, areas and details", () => {
    const answers = answersFromSpots(
      emptyAnswers(),
      [spot({ choices: ["mulch", "trim"] }), spot({ choices: ["rock", "weeds"] }), spot({ choices: ["other"] })],
      (s) => (s.choices.includes("rock") ? "back" : "front")
    );
    expect(answers.property).toBe("home");
    expect(answers.services.sort()).toEqual(["beds", "cleanup", "other"]);
    expect(answers.areas.sort()).toEqual(["back", "front"]);
    expect(answers.details.beds_add).toEqual(["mulch", "stone"]);
    expect(answers.details.cleanup_what).toEqual(["trim", "weeds"]);
  });

  it("adds to what the form already holds", () => {
    const base = { ...emptyAnswers(), property: "home", services: ["lawn"], details: { lawn_need: ["redo"] }, concerns: [] };
    const answers = answersFromSpots(base, [spot({ choices: ["lawn"] })], () => null);
    expect(answers.services).toEqual(["lawn"]);
    expect(answers.details.lawn_need).toEqual(["redo", "patch"]);
    expect(answers.areas).toEqual([]);
  });
});
