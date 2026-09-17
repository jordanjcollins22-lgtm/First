import { describe, expect, it } from "vitest";

import { isQuoteToken, parseMoney, quoteToken, serviceGroups, withoutZoneTalk } from "./sub-quotes";

const zone = (serviceLabel: string, scopeText: string, photoPaths: string[] = []) => ({ serviceLabel, scopeText, photoPaths });

describe("serviceGroups", () => {
  it("folds every area of a service into one group, in first-seen order", () => {
    const groups = serviceGroups([
      zone("Weed Removal", "Pull the weeds.", ["a.jpg"]),
      zone("Soft Washing", "Wash the shed.", ["b.jpg", "c.jpg"]),
      zone("Weed Removal", "Clear the vines."),
      zone("Soft Washing", "Wash the mailbox."),
      zone("", "No service on this one."),
    ]);
    expect(groups.map((g) => [g.serviceLabel, g.areas.length])).toEqual([
      ["Weed Removal", 2],
      ["Soft Washing", 2],
    ]);
    expect(groups[1].areas[0].photoPaths).toEqual(["b.jpg", "c.jpg"]);
  });
});

describe("withoutZoneTalk", () => {
  it("says area where the office said zone", () => {
    expect(withoutZoneTalk("We will trim the large bush in Zone 4 to a tidy shape.")).toBe("We will trim the large bush in this area to a tidy shape.");
    expect(withoutZoneTalk("Clear the weeds from both sides of Zone 5.")).toBe("Clear the weeds from both sides of this area.");
    expect(withoutZoneTalk("Zone 7 gets a soft wash.")).toBe("this area gets a soft wash.");
    expect(withoutZoneTalk("Wash the deck railings.")).toBe("Wash the deck railings.");
  });
});

describe("tokens and money", () => {
  it("makes a 24 character hex token", () => {
    const token = quoteToken(() => 0.5);
    expect(token).toHaveLength(24);
    expect(isQuoteToken(token)).toBe(true);
    expect(isQuoteToken("nope")).toBe(false);
  });

  it("reads a price the way people type it", () => {
    expect(parseMoney("$1,250")).toBe(1250);
    expect(parseMoney("450.5")).toBe(450.5);
    expect(parseMoney("free")).toBeNull();
    expect(parseMoney("0")).toBeNull();
  });
});
