import { describe, expect, it } from "vitest";

import { emptyAnswers } from "@/lib/evaluation-intake";
import type { AreaKey, LngLat } from "@/lib/lot-map";
import { answersFromSpots, areaForPoint, depositCents, MAX_SPOTS, parseTapSpots, readTapSpots, type TapSpot } from "@/lib/tap-estimate";

const jobId = "11111111-2222-3333-4444-555555555555";
const photo = `${jobId}/intake-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`;
const home: LngLat = [-76.35, 39.53];
const spot = (over: Partial<TapSpot> = {}): TapSpot => ({ lng: home[0], lat: home[1], choices: ["mulch"], photos: [photo], ...over });

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
