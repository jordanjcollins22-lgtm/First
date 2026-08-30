import { describe, expect, it } from "vitest";

import {
  MAX_SUGGESTIONS,
  contextBlock,
  daysSinceLastMessage,
  fallbackSuggestions,
  moneyMentioned,
  parseSuggestions,
  safeSuggestions,
  systemPrompt,
  waitingOnUs,
  type NudgeContext,
  plainDashes,
} from "./suggested-replies";

const NOW = new Date("2026-08-29T12:00:00Z");

function context(over: Partial<NudgeContext> = {}): NudgeContext {
  return {
    customerName: "Dana Ruiz",
    propertyAddress: "12 Oak St",
    stage: "proposal",
    dueNext: null,
    proposalStatus: "sent",
    proposalTotalCents: 100000,
    proposalActivity: "Opened 3 times in the last hour",
    paid: false,
    startDate: null,
    recentMessages: [
      { from: "team", body: "Sent your proposal over.", at: "2026-08-26T09:00:00Z" },
    ],
    ...over,
  };
}

describe("daysSinceLastMessage", () => {
  it("counts whole days of silence", () => {
    expect(daysSinceLastMessage(context(), NOW)).toBe(3);
  });

  it("is nothing on an empty thread", () => {
    expect(daysSinceLastMessage(context({ recentMessages: [] }), NOW)).toBeNull();
  });

  it("survives an unreadable timestamp rather than reporting nonsense", () => {
    expect(
      daysSinceLastMessage(context({ recentMessages: [{ from: "team", body: "x", at: "nope" }] }), NOW)
    ).toBeNull();
  });
});

describe("waitingOnUs", () => {
  it("is true when the client spoke last", () => {
    expect(
      waitingOnUs(context({ recentMessages: [{ from: "client", body: "?", at: NOW.toISOString() }] }))
    ).toBe(true);
  });

  it("is false when we did, and on an empty thread", () => {
    expect(waitingOnUs(context())).toBe(false);
    expect(waitingOnUs(context({ recentMessages: [] }))).toBe(false);
  });
});

describe("contextBlock", () => {
  it("gives the model the facts it is allowed to use", () => {
    const block = contextBlock(context(), NOW);
    expect(block).toContain("Dana Ruiz");
    expect(block).toContain("12 Oak St");
    expect(block).toContain("$1,000.00");
    expect(block).toContain("Opened 3 times in the last hour");
    expect(block).toContain("Last message: 3 days ago");
    expect(block).toContain("We spoke last");
  });

  it("says plainly when a thread has nothing in it", () => {
    expect(contextBlock(context({ recentMessages: [] }), NOW)).toContain("(nothing said yet)");
  });

  it("leaves out what it does not know rather than saying unknown", () => {
    const block = contextBlock(context({ proposalTotalCents: null, proposalStatus: null }), NOW);
    expect(block).not.toContain("Proposal total");
    expect(block).not.toContain("Proposal status");
  });

  it("labels the two sides so the model knows who it is writing as", () => {
    const block = contextBlock(
      context({
        recentMessages: [
          { from: "client", body: "Can we push it a week?", at: "2026-08-28T09:00:00Z" },
        ],
      }),
      NOW
    );
    expect(block).toContain("Them: Can we push it a week?");
    expect(block).toContain("They spoke last");
  });
});

describe("systemPrompt", () => {
  it("states the two goals and the limits", () => {
    const prompt = systemPrompt();
    expect(prompt).toMatch(/never promise a date/i);
    expect(prompt).toMatch(/never state a price/i);
    expect(prompt).toContain(String(MAX_SUGGESTIONS));
  });
});

describe("parseSuggestions", () => {
  it("reads one draft per line", () => {
    expect(parseSuggestions("First draft.\nSecond draft.\nThird draft.")).toEqual([
      "First draft.",
      "Second draft.",
      "Third draft.",
    ]);
  });

  it("strips the bullets and numbering a model adds out of habit", () => {
    expect(parseSuggestions("1. One\n- Two\n• Three")).toEqual(["One", "Two", "Three"]);
  });

  it("strips wrapping quotes", () => {
    expect(parseSuggestions('"Hello there"')).toEqual(["Hello there"]);
  });

  it("drops a duplicate rather than offering the same draft twice", () => {
    expect(parseSuggestions("Same\nSame\nDifferent")).toEqual(["Same", "Different"]);
  });

  it("drops a line long enough to be commentary rather than a draft", () => {
    const essay = "x".repeat(400);
    expect(parseSuggestions(`${essay}\nA real draft.`)).toEqual(["A real draft."]);
  });

  it("never returns more than it was asked for", () => {
    expect(parseSuggestions("a\nb\nc\nd\ne")).toHaveLength(MAX_SUGGESTIONS);
  });

  it("returns nothing for an empty answer", () => {
    expect(parseSuggestions("   \n\n")).toEqual([]);
  });
});

describe("moneyMentioned", () => {
  it("finds figures however they are written", () => {
    expect(moneyMentioned("It is $1,000.00 or $700 total")).toEqual(["$1000", "$700"]);
  });

  it("finds nothing where there is nothing", () => {
    expect(moneyMentioned("Which day suits you?")).toEqual([]);
  });
});

describe("safeSuggestions", () => {
  const facts = "Proposal total: $1,000.00";

  it("keeps a draft quoting the price we actually gave it", () => {
    expect(safeSuggestions(["Your total is $1,000 as quoted."], facts)).toHaveLength(1);
  });

  it("drops a draft quoting a price nobody gave it", () => {
    // The one mistake that costs money: a number the customer has now been
    // told, which we would have to correct.
    expect(safeSuggestions(["We can do it for $750."], facts)).toEqual([]);
  });

  it("keeps drafts with no money in them at all", () => {
    expect(safeSuggestions(["Which day suits you?"], facts)).toHaveLength(1);
  });

  it("drops only the offending draft, not the batch", () => {
    expect(safeSuggestions(["Which day suits?", "How about $75?"], facts)).toEqual([
      "Which day suits?",
    ]);
  });
});

describe("fallbackSuggestions", () => {
  it("answers rather than nudges when the client spoke last", () => {
    const out = fallbackSuggestions(
      context({ recentMessages: [{ from: "client", body: "Can you come Friday?", at: NOW.toISOString() }] }),
      NOW
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("Dana");
    expect(out.some((s) => /day this week/i.test(s))).toBe(true);
  });

  it("chases an unanswered quote and asks about days", () => {
    const out = fallbackSuggestions(context(), NOW);
    expect(out.some((s) => /proposal/i.test(s))).toBe(true);
    expect(out.some((s) => /day of the week/i.test(s))).toBe(true);
  });

  it("goes for the diary once it is paid and unbooked", () => {
    const out = fallbackSuggestions(context({ paid: true, proposalStatus: "accepted" }), NOW);
    expect(out[0]).toMatch(/diary/i);
  });

  it("never invents a price or a date", () => {
    for (const overrides of [
      {},
      { paid: true, proposalStatus: "accepted" },
      { startDate: "2026-09-04" },
      { recentMessages: [{ from: "client", body: "hi", at: NOW.toISOString() }] },
      { recentMessages: [] },
    ]) {
      for (const suggestion of fallbackSuggestions(context(overrides), NOW)) {
        expect(moneyMentioned(suggestion)).toEqual([]);
        expect(suggestion).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/);
      }
    }
  });

  it("always has something to say", () => {
    expect(fallbackSuggestions(context({ recentMessages: [] }), NOW).length).toBeGreaterThan(0);
  });

  it("copes with a customer who has no name on file", () => {
    expect(fallbackSuggestions(context({ customerName: "" }), NOW)[0]).toContain("there");
  });
});

describe("no dashes anywhere a client would see one", () => {
  it("takes an em dash out and leaves a sentence somebody would type", () => {
    // The single clearest tell that nobody typed this.
    expect(plainDashes("Hi Dana — happy to start whenever suits.")).toBe(
      "Hi Dana, happy to start whenever suits."
    );
  });

  it("handles an en dash the same way", () => {
    expect(plainDashes("Hi Dana – checking in.")).toBe("Hi Dana, checking in.");
  });

  it("does not leave a double comma behind", () => {
    // Swapping one tell for another is not a fix.
    expect(plainDashes("Ready, — and waiting")).toBe("Ready, and waiting");
    expect(plainDashes("Ready — , and waiting")).toBe("Ready, and waiting");
  });

  it("does not strand a comma before a full stop", () => {
    expect(plainDashes("That is everything —.")).toBe("That is everything.");
  });

  it("does not leave a dangling comma at the end", () => {
    expect(plainDashes("Let me know —")).toBe("Let me know");
  });

  it("leaves a hyphenated word alone", () => {
    expect(plainDashes("A well-kept front garden")).toBe("A well-kept front garden");
  });

  it("leaves a draft that never had one alone", () => {
    const clean = "Which day of the week generally works best for you?";
    expect(plainDashes(clean)).toBe(clean);
  });

  it("cleans what the model sends back, not just what we wrote", () => {
    const parsed = parseSuggestions("Hi Dana — got your message.\nHi Dana — which day suits?");
    expect(parsed).toEqual(["Hi Dana, got your message.", "Hi Dana, which day suits?"]);
  });

  it("asks the model for none in the first place", () => {
    expect(systemPrompt()).toMatch(/never use a dash/i);
  });

  it("has none in the drafts we write ourselves", () => {
    for (const overrides of [
      {},
      { paid: true, proposalStatus: "accepted" },
      { startDate: "2026-09-04" },
      { recentMessages: [{ from: "client", body: "hi", at: NOW.toISOString() }] },
      { recentMessages: [] },
    ]) {
      for (const suggestion of fallbackSuggestions(context(overrides), NOW)) {
        expect(suggestion).not.toMatch(/[—–]/);
      }
    }
  });

  it("has none in the facts the model reads before it writes", () => {
    expect(contextBlock(context(), NOW)).not.toMatch(/[—–]/);
  });
});
