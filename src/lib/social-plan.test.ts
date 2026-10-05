import { describe, expect, it } from "vitest";

import { cleanHashtags, composePlanCaption, planProblems, planSlot } from "@/lib/social-plan";

const post = {
  hook: "Fall cleanup spots open in Harford County",
  body: "We're booking leaf cleanups and mulch.",
  cta: "Book a free evaluation: {link}",
  hashtags: ["HarfordCounty", "#BelAirMD", "#fall cleanup", "#BelAirMD", "LeafRemoval", "Extra1", "Extra2"],
};

describe("the week's posts", () => {
  it("puts hook, body, call to action with the link, and hashtags together", () => {
    expect(composePlanCaption(post, "https://x.test/r/abc")).toBe(
      "Fall cleanup spots open in Harford County\n\nWe're booking leaf cleanups and mulch.\n\nBook a free evaluation: https://x.test/r/abc\n\n#HarfordCounty #BelAirMD #fallcleanup #LeafRemoval #Extra1"
    );
  });

  it("keeps hashtags to five single words, once each", () => {
    expect(cleanHashtags(["#a b", "A b", "c"])).toEqual(["#ab", "#c"]);
  });

  it("refuses prices, licence claims and a missing call to action", () => {
    expect(planProblems(post)).toEqual([]);
    expect(planProblems({ ...post, body: "Only $99, fully insured", cta: "" })).toEqual([
      "It needs a call to action.",
      "It names a price.",
      "It claims a licence or insurance.",
    ]);
  });

  it("goes out at ten on its day, or at once if that has passed", () => {
    const now = new Date("2026-10-05T16:00:00Z");
    expect(planSlot("2026-10-07", now).toISOString()).toBe("2026-10-07T14:00:00.000Z");
    expect(planSlot("2026-10-05", now).toISOString()).toBe(now.toISOString());
  });
});

describe("weekStart", () => {
  it("is the Monday of this week, Eastern time", async () => {
    const { weekStart } = await import("@/lib/social-plan");
    expect(weekStart(new Date("2026-10-05T13:00:00Z"))).toBe("2026-10-05");
    expect(weekStart(new Date("2026-10-11T23:00:00Z"))).toBe("2026-10-05");
    expect(weekStart(new Date("2026-10-12T03:00:00Z"))).toBe("2026-10-05"); // Sunday night in Maryland
  });
});
