import { describe, expect, it } from "vitest";

import { DEFAULT_OFFER, DEFAULT_STORY, companyBrief, sequenceProblems, writerSystemPrompt } from "@/lib/pm-writer-prompt";

describe("the writer's brief", () => {
  it("carries the story, the offer and this season's lead", () => {
    const prompt = writerSystemPrompt({ businessName: "JS Landscaping MD", sender: "Jordan", phone: "443-900-8084", story: DEFAULT_STORY, offer: DEFAULT_OFFER, season: "snow" });
    expect(prompt).toContain("when I was 11");
    expect(prompt).toContain("Lead with snow removal");
    expect(prompt).toContain("443-900-8084");
  });

  it("says who to write to, or the office", () => {
    expect(companyBrief({ name: "Sample Property Co", address: null, website: null, contactName: null })).toContain("the office");
  });
});

describe("sequenceProblems", () => {
  const ok = { step: 1, subject: "snow at your bel air properties", body: "Hi there, I'm Jordan." };
  it("passes a clean sequence and catches links, prices and claims", () => {
    expect(sequenceProblems({ emails: [ok, { ...ok, step: 2 }, { ...ok, step: 3 }] })).toEqual([]);
    const bad = sequenceProblems({ emails: [{ ...ok, body: "See www.sample.com, from $40, fully insured" }, { ...ok, step: 2 }, { ...ok, step: 3 }] });
    expect(bad).toHaveLength(3);
  });
});
