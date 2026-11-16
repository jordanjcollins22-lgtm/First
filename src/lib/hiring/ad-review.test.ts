import { describe, expect, it } from "vitest";

import { adReady, reviewAd } from "@/lib/hiring/ad-review";
import { indeedAd } from "@/lib/hiring/indeed-ad";
import { OPEN_POSITIONS, positionFor } from "@/lib/hiring/positions";

const input = { business: "JS Landscaping MD", area: "Harford County, Maryland", applyUrl: "https://example.com/apply" };

describe("reviewAd", () => {
  it("passes every open job's ad as written", () => {
    for (const p of OPEN_POSITIONS) {
      const checks = reviewAd(p, indeedAd(p, input).body);
      expect(checks.filter((c) => !c.passed).map((c) => `${p.key}: ${c.label}`)).toEqual([]);
      expect(adReady(checks)).toBe(true);
    }
  });

  it("names corporate words to swap out", () => {
    const p = positionFor("project-technician")!;
    const plain = reviewAd(p, "We need a self-starter in a fast-paced environment").find((c) => c.key === "plain")!;
    expect(plain.passed).toBe(false);
    expect(plain.fix).toContain("self-starter");
    expect(plain.fix).toContain("fast-paced environment");
  });
});
