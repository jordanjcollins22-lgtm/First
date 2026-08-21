import { describe, expect, it } from "vitest";

import { PROPOSAL_ACCEPT_NOTE, PROPOSAL_TERMS } from "@/lib/proposal-terms";

describe("proposal terms", () => {
  it("states the two rules the business actually needs stated", () => {
    // A guard against these being trimmed to nothing in a later tidy-up: the
    // whole point is that a client cannot say they were never told.
    const text = PROPOSAL_TERMS.map((t) => `${t.heading} ${t.body}`).join(" ").toLowerCase();
    expect(text).toContain("before you accept");
    expect(text).toContain("separate visit");
  });

  it("takes the decision off the crew", () => {
    const text = PROPOSAL_TERMS.map((t) => `${t.heading} ${t.body}`).join(" ").toLowerCase();
    expect(text).toContain("crew");
    expect(text).toMatch(/not able to price|cannot add work/);
  });

  it("ties acceptance to the terms rather than leaving them decorative", () => {
    expect(PROPOSAL_ACCEPT_NOTE.toLowerCase()).toContain("quoted and scheduled separately");
  });

  it("has no empty term", () => {
    for (const term of PROPOSAL_TERMS) {
      expect(term.heading.trim().length).toBeGreaterThan(0);
      expect(term.body.trim().length).toBeGreaterThan(0);
    }
  });
});
