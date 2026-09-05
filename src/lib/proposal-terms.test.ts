import { describe, expect, it } from "vitest";

import {
  PROPOSAL_ACCEPT_NOTE,
  PROPOSAL_TERMS,
  PROPOSAL_TERMS_TITLE,
  PROPOSAL_TERMS_TITLE_AGREED,
} from "@/lib/proposal-terms";

const ALL = PROPOSAL_TERMS.map((t) => `${t.heading} ${t.body}`).join(" ");
const LOWER = ALL.toLowerCase();

describe("proposal terms", () => {
  it("says changes have to happen before signing", () => {
    // A guard against these being trimmed to nothing in a later tidy-up: the
    // whole point is that a client cannot say they were never told.
    expect(LOWER).toMatch(/before you (accept|sign)/);
  });

  it("says anything added later is its own visit", () => {
    expect(LOWER).toContain("separate visit");
  });

  it("takes the decision off the crew", () => {
    expect(LOWER).toContain("crew");
    expect(LOWER).toMatch(/not able to price|cannot add work/);
  });

  it("warns that the schedule moves with the weather", () => {
    // The one expectation nobody controls. Said up front, a rained-out
    // Tuesday is something that was always possible rather than a failure.
    expect(LOWER).toContain("weather");
    expect(LOWER).toMatch(/rain|frozen/);
  });

  it("ties acceptance to the terms rather than leaving them decorative", () => {
    expect(PROPOSAL_ACCEPT_NOTE.toLowerCase()).toMatch(/priced and booked|quoted and scheduled/);
  });

  it("uses no dashes anywhere a client reads", () => {
    // Asked for explicitly. An em or en dash in this paragraph reads as
    // legalese in the ten seconds before somebody commits money.
    const clientFacing = [ALL, PROPOSAL_ACCEPT_NOTE, PROPOSAL_TERMS_TITLE, PROPOSAL_TERMS_TITLE_AGREED];
    for (const text of clientFacing) {
      expect(text).not.toMatch(/[—–]/);
    }
  });

  it("has no empty term", () => {
    for (const term of PROPOSAL_TERMS) {
      expect(term.heading.trim().length).toBeGreaterThan(0);
      expect(term.body.trim().length).toBeGreaterThan(0);
    }
  });
});
