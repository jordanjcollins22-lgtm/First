import { describe, expect, it } from "vitest";

import {
  briefFor,
  cleanScopeText,
  cleanTidyText,
  hasQuantity,
  splitSentences,
  worthSuggesting,
  type ZoneBrief,
} from "@/lib/scope-suggestion";

function brief(over: Partial<ZoneBrief> = {}): ZoneBrief {
  return {
    zoneName: "Zone 2",
    serviceLabel: "Landscape Cleanup",
    notes: "Client wants everything trimmed, dog dug up the mulch",
    checklistAnswers: [],
    materials: [],
    ...over,
  };
}

describe("briefFor", () => {
  it("leads with the area and the service", () => {
    expect(briefFor(brief())).toContain("Work area: Zone 2");
    expect(briefFor(brief())).toContain("Service: Landscape Cleanup");
  });

  it("carries the evaluator's notes through", () => {
    expect(briefFor(brief())).toContain("dog dug up the mulch");
  });

  it("includes answered checklist items and skips blank ones", () => {
    const text = briefFor(
      brief({
        checklistAnswers: [
          { label: "Mulch colour", value: "Brown" },
          { label: "Edging", value: "   " },
        ],
      })
    );
    expect(text).toContain("Mulch colour: Brown");
    expect(text).not.toContain("Edging");
  });

  it("names materials without quantities, so there is no number to quote", () => {
    const text = briefFor(brief({ materials: ["Hardwood mulch", "Topsoil"] }));
    const materialsLine = text.split("\n").find((line) => line.startsWith("Materials in use:"));
    expect(materialsLine).toBe("Materials in use: Hardwood mulch, Topsoil");
    expect(materialsLine).not.toMatch(/\d/);
  });

  it("omits the notes line entirely when nothing was typed", () => {
    expect(briefFor(brief({ notes: "" }))).not.toContain("Evaluator's notes");
  });
});

describe("worthSuggesting", () => {
  it("is true when the evaluator wrote something", () => {
    expect(worthSuggesting(brief())).toBe(true);
  });

  it("is true when only the checklist was answered", () => {
    expect(
      worthSuggesting(brief({ notes: "", checklistAnswers: [{ label: "Edging", value: "Yes" }] }))
    ).toBe(true);
  });

  it("is false when there is nothing but a service name", () => {
    expect(worthSuggesting(brief({ notes: "  ", checklistAnswers: [] }))).toBe(false);
  });
});

describe("hasQuantity", () => {
  it.each([
    "We will spread 3 cubic yards of mulch.",
    "About 50 sq ft of bed.",
    "Removing 2 tons of debris.",
    "Roughly 12 inches deep.",
    "Around 4 hours on site.",
    "That comes to $450.",
    "We will plant 3 shrubs.",
  ])("catches %s", (sentence) => {
    expect(hasQuantity(sentence)).toBe(true);
  });

  it.each([
    "We will refresh the mulch beds so they look tidy again.",
    "Anything drooping gets trimmed back.",
    "A concrete pad goes in under the trash cans.",
  ])("leaves %s alone", (sentence) => {
    expect(hasQuantity(sentence)).toBe(false);
  });
});

describe("splitSentences", () => {
  it("keeps the punctuation that ended each sentence", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("keeps a trailing sentence with no full stop", () => {
    expect(splitSentences("One. Two")).toEqual(["One.", "Two"]);
  });

  it("is empty for empty input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("cleanScopeText", () => {
  it("replaces em and en dashes with a comma", () => {
    const text = cleanScopeText("We tidy the beds — and the edges — so it reads as maintained.");
    expect(text).not.toMatch(/[—–]/);
    expect(text).toBe("We tidy the beds, and the edges, so it reads as maintained.");
  });

  it("leaves ordinary hyphens alone", () => {
    expect(cleanScopeText("A well-maintained front bed.")).toBe("A well-maintained front bed.");
  });

  it("drops a sentence that quotes a quantity and keeps the rest", () => {
    const text = cleanScopeText(
      "We refresh the mulch so the beds look sharp. We will spread 3 cubic yards of hardwood mulch."
    );
    expect(text).toBe("We refresh the mulch so the beds look sharp.");
  });

  it("drops a sentence that quotes a price", () => {
    expect(cleanScopeText("Tidy the beds. This runs $450.")).toBe("Tidy the beds.");
  });

  it("returns empty when every sentence quoted an amount", () => {
    expect(cleanScopeText("We spread 3 cubic yards. It costs $450.")).toBe("");
  });

  it("strips a model's opening label", () => {
    expect(cleanScopeText("Here is the scope line:\n\nWe tidy the beds.")).toBe("We tidy the beds.");
  });

  it("strips wrapping quotes", () => {
    expect(cleanScopeText('"We tidy the beds."')).toBe("We tidy the beds.");
  });

  it("collapses the whitespace a dash swap can leave behind", () => {
    expect(cleanScopeText("Trim the shrubs  —  then clear up.")).toBe("Trim the shrubs, then clear up.");
  });
});

describe("cleaning up a laid-out reply", () => {
  it("keeps the lines, which is the whole point", () => {
    const reply = "Beds\n• Weed by hand.\n• Edge the borders.";
    expect(cleanTidyText(reply)).toBe(reply);
  });

  it("keeps the blank line between one group and the next", () => {
    expect(cleanTidyText("A\n• one\n\nB\n• two")).toBe("A\n• one\n\nB\n• two");
  });

  it("takes off a model's opening label", () => {
    expect(cleanTidyText("Here it is:\n\nBeds\n• Weed.")).toBe("Beds\n• Weed.");
  });

  it("takes off a code fence", () => {
    expect(cleanTidyText("```\nBeds\n• Weed.\n```")).toBe("Beds\n• Weed.");
  });

  it("applies the house style on dashes", () => {
    expect(cleanTidyText("• Weed the beds — by hand.")).toBe("• Weed the beds, by hand.");
  });

  it("keeps a number, because taking one out would be removing something", () => {
    // The opposite of the write-from-notes path: these words are the
    // business's own and a client has been quoted against them.
    const line = "• Cut at three inches, every 7 days.";
    expect(cleanTidyText(line)).toBe(line);
  });

  it("does not run three blank lines together", () => {
    expect(cleanTidyText("A\n• one\n\n\n\nB\n• two")).toBe("A\n• one\n\nB\n• two");
  });

  it("gives back nothing for nothing", () => {
    expect(cleanTidyText("   ")).toBe("");
  });
});
