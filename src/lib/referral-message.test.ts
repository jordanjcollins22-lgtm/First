import { describe, expect, it } from "vitest";

import { AFFILIATIONS, affiliationLabel, isAffiliation, referralMessage } from "@/lib/referral-message";

const base = { name: "pat smith", link: "https://example.com/r/abc1234", business: "JS Landscaping MD", from: "Morgan Sample" };

describe("referral message", () => {
  it("carries their link and their first name for every relationship", () => {
    for (const a of AFFILIATIONS) {
      const m = referralMessage({ ...base, affiliation: a.key });
      expect(m).toContain(base.link);
      expect(m).toContain("Pat");
      expect(m).toContain("JS Landscaping MD");
    }
  });

  it("never promises a free estimate", () => {
    for (const a of AFFILIATIONS) expect(referralMessage({ ...base, affiliation: a.key }).toLowerCase()).not.toContain("free");
  });

  it("fits how they know them", () => {
    expect(referralMessage({ ...base, affiliation: "neighbor" })).toContain("It's Morgan from down the street");
    expect(referralMessage({ ...base, affiliation: "coworker" })).toContain("from work");
  });

  it("is laid out like a text: greeting alone, blank lines between parts, link on its own line", () => {
    const m = referralMessage({ ...base, affiliation: "neighbor" });
    const parts = m.split("\n\n");
    expect(parts[0]).toBe("Hey Pat!");
    expect(parts).toHaveLength(4);
    expect(m.split("\n")).toContain(base.link);
    expect(m).not.toMatch(/\n{3,}/);
  });

  it("knows the relationships", () => {
    expect(isAffiliation("neighbor")).toBe(true);
    expect(isAffiliation("boss")).toBe(false);
    expect(affiliationLabel("online")).toBe("Someone online");
  });
});
