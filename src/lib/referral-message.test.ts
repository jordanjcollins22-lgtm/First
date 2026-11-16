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
    expect(referralMessage({ ...base, affiliation: "neighbor" })).toContain("it's Morgan from down the street");
    expect(referralMessage({ ...base, affiliation: "coworker" })).toContain("from work");
  });

  it("knows the relationships", () => {
    expect(isAffiliation("neighbor")).toBe(true);
    expect(isAffiliation("boss")).toBe(false);
    expect(affiliationLabel("online")).toBe("Someone online");
  });
});
