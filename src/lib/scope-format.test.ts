import { describe, expect, it } from "vitest";

import {
  looksLikeHeading,
  normaliseItem,
  parseScope,
  renderScope,
  sameContent,
  shareScope,
  scopeContent,
  tidyScope,
} from "@/lib/scope-format";

/** The real thing, off a live proposal, as one unbroken paragraph. */
const REAL =
  "Initial Lawn Repair • Repair existing divots, ruts, low spots, and minor surface damage caused by " +
  "the previous lawn care provider. • Add and grade topsoil as needed to restore damaged areas to a " +
  "smooth, mowable surface. • Seed repaired areas and designated bare or thin areas. • Apply straw " +
  "or appropriate seed protection where needed. • Blend repaired areas into the surrounding lawn as " +
  "reasonably possible. Recurring Lawn Maintenance • Mow all designated grass areas shown on the " +
  "property map. • Trim around buildings, curbs, signs, landscape beds, trees, poles, fences, and " +
  "other obstacles. • Edge designated sidewalks, curbs, and landscape bed edges as needed to " +
  "maintain a clean appearance. • Blow grass clippings and lawn debris from sidewalks, entrances, " +
  "curbs, parking areas, and other hard surfaces after service. • Avoid excessive scalping, rutting, " +
  "or turf damage during mowing. • Remove or disperse excessive grass clumps left from mowing.";

describe("telling a heading from a sentence", () => {
  it("calls a short label with no full stop a heading", () => {
    expect(looksLikeHeading("Initial Lawn Repair")).toBe(true);
    expect(looksLikeHeading("Recurring Lawn Maintenance")).toBe(true);
  });

  it("does not call a sentence a heading", () => {
    expect(looksLikeHeading("Seed repaired areas and designated bare or thin areas.")).toBe(false);
  });

  it("does not call a long fragment a heading, punctuation or not", () => {
    expect(
      looksLikeHeading("Blow grass clippings and lawn debris from sidewalks and entrances after service")
    ).toBe(false);
  });

  it("does not call nothing a heading", () => {
    expect(looksLikeHeading("")).toBe(false);
    expect(looksLikeHeading("   ")).toBe(false);
  });
});

describe("reading the real scope", () => {
  const sections = parseScope(REAL);

  it("finds both headings", () => {
    expect(sections.map((s) => s.heading)).toEqual(["Initial Lawn Repair", "Recurring Lawn Maintenance"]);
  });

  it("puts every bullet under the right heading", () => {
    expect(sections[0].items).toHaveLength(5);
    expect(sections[1].items).toHaveLength(6);
  });

  it("finds the heading hiding at the end of a bullet", () => {
    // "...as reasonably possible. Recurring Lawn Maintenance" is one bullet
    // and the next heading run together, which is how it was typed.
    expect(sections[0].items[4]).toBe("Blend repaired areas into the surrounding lawn as reasonably possible.");
    expect(sections[1].heading).toBe("Recurring Lawn Maintenance");
  });

  it("says the same things afterwards as before", () => {
    expect(sameContent(REAL, tidyScope(REAL))).toBe(true);
  });

  it("keeps all thirteen pieces of wording", () => {
    // Two headings and eleven bullets. If this number moves, something was
    // added or dropped.
    expect(scopeContent(tidyScope(REAL))).toHaveLength(13);
  });

  it("reads back what it wrote", () => {
    expect(parseScope(tidyScope(REAL))).toEqual(sections);
  });

  it("is stable: tidying a tidy scope changes nothing", () => {
    expect(tidyScope(tidyScope(REAL))).toBe(tidyScope(REAL));
  });
});

describe("scopes that are not bulleted", () => {
  it("leaves a written paragraph as a paragraph", () => {
    // Cutting prose into bullets would be a rewrite, and this does not
    // rewrite.
    const prose = "We will mow the lawn, trim the edges and blow the paths off before we leave.";
    expect(parseScope(prose)).toEqual([{ heading: null, items: [prose] }]);
    expect(tidyScope(prose)).toBe(prose);
  });

  it("keeps text that already has one thing per line", () => {
    const lines = "Beds\n• Weed by hand.\n• Edge the borders.";
    expect(parseScope(lines)).toEqual([{ heading: "Beds", items: ["Weed by hand.", "Edge the borders."] }]);
  });

  it("takes a dash or a star as a bullet too", () => {
    expect(parseScope("Beds\n- Weed by hand.\n* Edge the borders.")[0].items).toEqual([
      "Weed by hand.",
      "Edge the borders.",
    ]);
  });

  it("does not turn a bulleted short line into a heading", () => {
    // The bullet is the author saying it is an item, whatever it looks like.
    expect(parseScope("Beds\n• Weed by hand\n• Edge")[0].items).toEqual(["Weed by hand", "Edge"]);
  });

  it("gives back nothing for nothing", () => {
    expect(parseScope("")).toEqual([]);
    expect(parseScope("   ")).toEqual([]);
    expect(tidyScope("")).toBe("");
  });

  it("keeps an opening that is a sentence rather than a heading", () => {
    const text = "We do the following. • Mow. • Edge.";
    expect(parseScope(text)[0].heading).toBeNull();
    expect(parseScope(text)[0].items).toEqual(["We do the following.", "Mow.", "Edge."]);
  });
});

describe("writing the sections back out", () => {
  it("puts the heading on its own line and bullets the rest", () => {
    expect(renderScope([{ heading: "Beds", items: ["Weed.", "Edge."] }])).toBe("Beds\n• Weed.\n• Edge.");
  });

  it("separates sections with a blank line", () => {
    const text = renderScope([
      { heading: "One", items: ["a"] },
      { heading: "Two", items: ["b"] },
    ]);
    expect(text).toBe("One\n• a\n\nTwo\n• b");
  });

  it("writes a section with no heading as bullets alone", () => {
    expect(renderScope([{ heading: null, items: ["a", "b"] }])).toBe("• a\n• b");
  });

  it("writes a heading with nothing under it as just the heading", () => {
    expect(renderScope([{ heading: "Beds", items: [] }])).toBe("Beds");
  });
});

describe("checking that nothing was added or removed", () => {
  it("passes when the order changed and nothing else did", () => {
    const before = "Beds\n• Weed.\n• Edge.";
    const after = "Beds\n• Edge.\n• Weed.";
    expect(sameContent(before, after)).toBe(true);
  });

  it("passes when only capitals and punctuation moved", () => {
    expect(sameContent("• weed the beds", "• Weed the beds.")).toBe(true);
  });

  it("fails when a line was dropped", () => {
    expect(sameContent("Beds\n• Weed.\n• Edge.", "Beds\n• Weed.")).toBe(false);
  });

  it("fails when a line was invented", () => {
    expect(sameContent("Beds\n• Weed.", "Beds\n• Weed.\n• Mulch.")).toBe(false);
  });

  it("fails when a clause was quietly trimmed off a line", () => {
    const before = "• Trim around buildings, curbs, signs, landscape beds, trees, poles and fences.";
    const after = "• Trim around buildings and curbs.";
    expect(sameContent(before, after)).toBe(false);
  });

  it("fails when a line said twice comes back said once", () => {
    // A duplicate is still something the client was shown, so losing one is
    // losing something.
    expect(sameContent("• Mow.\n• Mow.", "• Mow.")).toBe(false);
  });

  it("fails when a heading was dropped", () => {
    expect(sameContent("Beds\n• Weed.", "• Weed.")).toBe(false);
  });

  it("holds for the real scope against itself" , () => {
    expect(sameContent(REAL, REAL)).toBe(true);
  });
});

describe("reducing a line to what it says", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normaliseItem("  Weed the beds, by hand.  ")).toBe(normaliseItem("weed the beds by hand"));
  });

  it("keeps apostrophes, which change words", () => {
    expect(normaliseItem("the client's gate")).toContain("client's");
  });

  it("is empty for punctuation alone", () => {
    expect(normaliseItem("•  —  .")).toBe("");
  });
});

describe("the one scope a service's areas share", () => {
  it("finds it when every area says the same thing", () => {
    const result = shareScope(["Mow and edge.", "Mow and edge.", "Mow and edge."]);
    expect(result.shared).toBe("Mow and edge.");
    expect(result.exceptions).toEqual([]);
  });

  it("names the area that says something else", () => {
    const result = shareScope(["Mow and edge.", "Mow and edge.", "Gate is padlocked."]);
    expect(result.shared).toBe("Mow and edge.");
    expect(result.exceptions).toEqual([2]);
  });

  it("takes the wording most of them carry", () => {
    const result = shareScope(["a", "b", "b"]);
    expect(result.shared).toBe("b");
    expect(result.exceptions).toEqual([0]);
  });

  it("ignores the spacing around it", () => {
    expect(shareScope(["  Mow.  ", "Mow."]).exceptions).toEqual([]);
  });

  it("handles a service with one area", () => {
    expect(shareScope(["Mow."])).toEqual({ shared: "Mow.", exceptions: [] });
  });

  it("handles a service whose areas say nothing at all", () => {
    expect(shareScope(["", "  "])).toEqual({ shared: "", exceptions: [] });
  });

  it("handles no areas", () => {
    expect(shareScope([])).toEqual({ shared: "", exceptions: [] });
  });
});
