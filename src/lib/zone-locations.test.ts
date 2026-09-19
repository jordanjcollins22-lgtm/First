import { describe, expect, it } from "vitest";
import { matchesSuggestion, MAX_SUGGESTIONS, suggestedLocations } from "./zone-locations";

const at = (location: string) => ({ location });

describe("suggestedLocations", () => {
  it("offers back the places already named on this property", () => {
    expect(
      suggestedLocations([at("Front yard"), at("Side by the driveway"), at("Back garden")])
    ).toEqual(["Back garden", "Side by the driveway", "Front yard"]);
  });

  it("puts the most recent first, not the most common", () => {
    // An evaluator works round a property in order. Where they were a moment
    // ago beats where they started.
    expect(suggestedLocations([at("Front"), at("Front"), at("Back")])[0]).toBe("Back");
  });

  it("offers one place once, however many zones are in it", () => {
    expect(suggestedLocations([at("Front yard"), at("Front yard"), at("Front yard")])).toEqual([
      "Front yard",
    ]);
  });

  it("treats two spellings of one place as one place", () => {
    // Four spellings of "front yard" read as four places on the crew sheet.
    const out = suggestedLocations([at("Front yard"), at("front  YARD "), at("Back")]);
    expect(out).toHaveLength(2);
    // Offered in the most recent spelling, since that is the one they are
    // currently using — with the stray double space tidied so it does not
    // come back looking like a mistake to fix.
    expect(out).toContain("front YARD");
  });

  it("skips zones nobody put a location on", () => {
    expect(suggestedLocations([at(""), at("  "), at("Front")])).toEqual(["Front"]);
  });

  it("does not offer a zone its own location back", () => {
    const out = suggestedLocations([at("Front"), at("Back")], { exclude: "Back" });
    expect(out).toEqual(["Front"]);
  });

  it("caps how many it shows", () => {
    const many = Array.from({ length: 20 }, (_, i) => at(`Place ${i}`));
    expect(suggestedLocations(many)).toHaveLength(MAX_SUGGESTIONS);
  });

  it("has nothing to say about the first zone on a property", () => {
    // Nothing has been named yet, so there is nothing to offer and the field
    // is just a field.
    expect(suggestedLocations([])).toEqual([]);
  });
});

describe("matchesSuggestion", () => {
  it("matches regardless of spacing and case", () => {
    expect(matchesSuggestion("front yard", "Front Yard")).toBe(true);
    expect(matchesSuggestion(" Front  Yard ", "Front Yard")).toBe(true);
  });

  it("does not match a different place", () => {
    expect(matchesSuggestion("Back garden", "Front yard")).toBe(false);
  });

  it("does not call an empty field a match", () => {
    expect(matchesSuggestion("", "Front yard")).toBe(false);
    expect(matchesSuggestion("   ", "Front yard")).toBe(false);
  });
});
