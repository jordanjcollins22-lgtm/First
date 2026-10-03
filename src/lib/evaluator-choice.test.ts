import { describe, expect, it } from "vitest";

import { chooseEvaluator, SAME_TRIP_MILES, type EvaluatorDay } from "@/lib/evaluator-choice";

const PROPERTY = { lat: 39.5359, lng: -76.3483 };
/** About two miles away — the same trip out. */
const CLOSE = { lat: 39.5359, lng: -76.3123 };
/** About thirty miles away. */
const FAR = { lat: 39.5359, lng: -75.8 };

function day(evaluatorId: string, over: Partial<EvaluatorDay> = {}): EvaluatorDay {
  return { evaluatorId, visits: [], lastBookedAt: null, ...over };
}

describe("choosing who takes it", () => {
  it("gives it to whoever is already going that way", () => {
    // One trip out instead of two, which beats every other consideration.
    const choice = chooseEvaluator(
      ["a", "b"],
      [day("a", { visits: [FAR, FAR, FAR] }), day("b", { visits: [CLOSE] })],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("b");
    expect(choice?.why).toContain("miles away");
  });

  it("prefers the nearer of two who are both going that way", () => {
    const nearer = { lat: PROPERTY.lat, lng: PROPERTY.lng + 0.005 };
    const choice = chooseEvaluator(
      ["a", "b"],
      [day("a", { visits: [CLOSE] }), day("b", { visits: [nearer] })],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("b");
  });

  it("does not count a visit across the county as being on the way", () => {
    const choice = chooseEvaluator(
      ["a", "b"],
      [day("a", { visits: [FAR] }), day("b", { visits: [] })],
      PROPERTY
    );
    // Nobody is nearby, so it falls to the lighter day, which is b's.
    expect(choice?.evaluatorId).toBe("b");
  });

  it("spreads the work when nobody is nearby", () => {
    const choice = chooseEvaluator(
      ["busy", "quiet"],
      [day("busy", { visits: [FAR, FAR] }), day("quiet", { visits: [FAR] })],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("quiet");
    expect(choice?.why).toContain("lightest day");
  });

  it("rotates rather than always picking the same name", () => {
    // Two empty diaries. Whoever was booked longest ago gets it, so the list
    // order the database happened to return does not decide it.
    const choice = chooseEvaluator(
      ["first", "second"],
      [
        day("first", { lastBookedAt: "2026-09-09T12:00:00.000Z" }),
        day("second", { lastBookedAt: "2026-08-01T12:00:00.000Z" }),
      ],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("second");
  });

  it("treats somebody who has never had one as having waited longest", () => {
    const choice = chooseEvaluator(
      ["old_hand", "new_start"],
      [day("old_hand", { lastBookedAt: "2020-01-01T00:00:00.000Z" }), day("new_start")],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("new_start");
  });

  it("takes the only one free without pretending it was a decision", () => {
    const choice = chooseEvaluator(["solo"], [day("solo")], PROPERTY);
    expect(choice?.evaluatorId).toBe("solo");
    expect(choice?.why).toContain("only one free");
  });

  it("is nothing when nobody is free, rather than throwing", () => {
    // The caller's next move is to tell somebody the time just went.
    expect(chooseEvaluator([], [], PROPERTY)).toBeNull();
  });

  it("copes with a candidate it knows nothing about", () => {
    const choice = chooseEvaluator(["a", "unknown"], [day("a", { visits: [FAR, FAR] })], PROPERTY);
    // An unknown diary is an empty one, which is the lighter day.
    expect(choice?.evaluatorId).toBe("unknown");
  });

  it("still picks somebody when the property has no coordinates", () => {
    const choice = chooseEvaluator(
      ["a", "b"],
      [day("a", { visits: [CLOSE, CLOSE] }), day("b")],
      { lat: null, lng: null }
    );
    expect(choice?.evaluatorId).toBe("b");
  });

  it("ignores a visit with no coordinates instead of guessing at it", () => {
    const choice = chooseEvaluator(
      ["a", "b"],
      [day("a", { visits: [{ lat: null, lng: null }] }), day("b", { visits: [CLOSE] })],
      PROPERTY
    );
    expect(choice?.evaluatorId).toBe("b");
  });

  it("always names somebody from the list it was given", () => {
    const choice = chooseEvaluator(["a", "b", "c"], [], PROPERTY);
    expect(["a", "b", "c"]).toContain(choice?.evaluatorId);
  });

  it("draws the same-trip line somewhere sensible", () => {
    expect(SAME_TRIP_MILES).toBeGreaterThan(1);
    expect(SAME_TRIP_MILES).toBeLessThan(15);
  });
});
