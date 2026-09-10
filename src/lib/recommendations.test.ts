import { describe, expect, it } from "vitest";

import {
  draftPosts,
  groupWordFor,
  makeCode,
  PLATFORMS,
  platformLabel,
  recommendationLink,
  tallyByGroup,
  tallyByPerson,
  type Boasts,
  type RecommendationRow,
} from "@/lib/recommendations";

describe("the code that goes in the link", () => {
  it("cannot be misread down a phone", () => {
    // These get typed by somebody squinting at a screenshot. No l, no 1, no
    // 0, no o.
    const codes = Array.from({ length: 200 }, () => makeCode());
    for (const code of codes) expect(code).not.toMatch(/[l1o0]/);
  });

  it("is short enough to live in a URL somebody reads out", () => {
    expect(makeCode()).toHaveLength(7);
  });

  it("is different every time", () => {
    const codes = new Set(Array.from({ length: 500 }, () => makeCode()));
    expect(codes.size).toBeGreaterThan(490);
  });

  it("uses the randomness it is handed, so a test can pin it", () => {
    expect(makeCode(() => 0)).toBe("aaaaaaa");
  });
});

describe("the link itself", () => {
  it("credits the person and identifies the reply", () => {
    // The first already worked. The second is what lets a group be counted.
    const link = recommendationLink({
      baseUrl: "https://app.jslandscapingmd.com",
      affiliateSlug: "b49d3f3c5f",
      code: "kf3mq7z",
    });
    expect(link).toContain("ref=b49d3f3c5f");
    expect(link).toContain("rec=kf3mq7z");
    expect(link).toContain("/book?");
  });

  it("still works for somebody with no affiliate link of their own", () => {
    const link = recommendationLink({ baseUrl: "https://x.test", affiliateSlug: null, code: "abc2345" });
    expect(link).toBe("https://x.test/book?rec=abc2345");
  });

  it("does not double the slash when the base ends in one", () => {
    const link = recommendationLink({ baseUrl: "https://x.test/", affiliateSlug: null, code: "abc2345" });
    expect(link).not.toContain("//book");
  });
});

describe("what to post", () => {
  const full: Boasts = {
    businessName: "J's Landscaping",
    newsMention: "featured on WBAL",
    reviewCount: 120,
    reviewStars: 4.9,
  };
  const link = "https://x.test/book?ref=a&rec=b";

  it("offers a few ways to say it, so ten replies do not read as a bot", () => {
    const drafts = draftPosts(full, link);
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(drafts.map((d) => d.text)).size).toBe(drafts.length);
  });

  it("puts the link in every one of them", () => {
    for (const draft of draftPosts(full, link)) expect(draft.text).toContain(link);
  });

  it("names the business", () => {
    for (const draft of draftPosts(full, link)) expect(draft.text).toContain("J's Landscaping");
  });

  it("leads with the short one, because that is the one that gets used", () => {
    const drafts = draftPosts(full, link);
    expect(drafts[0].tone).toBe("Short");
    expect(drafts[0].text.length).toBeLessThan(drafts[1].text.length);
  });

  it("mentions the news when there is news", () => {
    expect(draftPosts(full, link).some((d) => d.text.includes("WBAL"))).toBe(true);
  });

  it("says nothing about the news when there is none", () => {
    const quiet = draftPosts({ ...full, newsMention: null }, link);
    for (const draft of quiet) {
      expect(draft.text).not.toMatch(/featured/i);
      expect(draft.text).not.toMatch(/\bnull\b|undefined/);
    }
  });

  it("boasts about reviews once there are enough to mean anything", () => {
    expect(draftPosts(full, link)[0].text).toContain("120 reviews");
  });

  it("keeps quiet about three reviews, which is not a boast", () => {
    // "Rated 5 stars by 3 people" reads worse than saying nothing.
    const thin = draftPosts({ ...full, reviewCount: 3, reviewStars: 5 }, link);
    for (const draft of thin) expect(draft.text).not.toMatch(/reviews/i);
  });

  it("keeps quiet about a mediocre average", () => {
    const meh = draftPosts({ ...full, reviewCount: 400, reviewStars: 3.9 }, link);
    for (const draft of meh) expect(draft.text).not.toMatch(/stars/i);
  });

  it("still says something when there is nothing to boast about", () => {
    const bare = draftPosts(
      { businessName: "J's Landscaping", newsMention: null, reviewCount: null, reviewStars: null },
      link
    );
    for (const draft of bare) {
      expect(draft.text).toContain(link);
      expect(draft.text.trim().length).toBeGreaterThan(20);
    }
  });

  it("copes with a business with no name set", () => {
    const nameless = draftPosts({ ...full, businessName: "  " }, link);
    expect(nameless[0].text).not.toContain("undefined");
  });
});

describe("naming the box for each platform", () => {
  it("calls it what the platform calls it", () => {
    expect(groupWordFor("facebook")).toBe("Group");
    expect(groupWordFor("nextdoor")).toBe("Neighbourhood");
    expect(groupWordFor("reddit")).toBe("Subreddit");
  });

  it("has a label and a word for every platform offered", () => {
    for (const platform of PLATFORMS) {
      expect(platformLabel(platform.key)).toBe(platform.label);
      expect(groupWordFor(platform.key).length).toBeGreaterThan(0);
    }
  });

  it("copes with a platform it does not know", () => {
    expect(platformLabel("myspace")).toBe("Somewhere else");
    expect(groupWordFor("myspace")).toBe("Where");
  });
});

function row(over: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    id: "r1",
    code: "aaa2222",
    platform: "facebook",
    groupName: "Bel Air Community",
    profileId: "p1",
    postedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("which groups are worth answering in", () => {
  const rows = [
    row({ code: "a1", groupName: "Bel Air Community" }),
    row({ code: "a2", groupName: "Bel Air Community" }),
    row({ code: "a3", groupName: "bel air community" }),
    row({ code: "b1", groupName: "Fallston Chat" }),
    row({ code: "c1", platform: "nextdoor", groupName: "Abingdon" }),
  ];

  it("counts by group, because 'Facebook works' is not something anybody can act on", () => {
    const tallies = tallyByGroup(rows, []);
    expect(tallies.find((t) => t.groupName === "Bel Air Community")?.posts).toBe(3);
  });

  it("treats the same group typed two ways as one group", () => {
    expect(tallyByGroup(rows, []).filter((t) => /bel air/i.test(t.groupName))).toHaveLength(1);
  });

  it("keeps a platform's groups apart from another's", () => {
    const tallies = tallyByGroup(rows, []);
    expect(tallies.some((t) => t.platform === "nextdoor")).toBe(true);
  });

  it("counts the bookings that carried a code back", () => {
    const tallies = tallyByGroup(rows, ["a1", "a2", "b1"]);
    expect(tallies.find((t) => t.groupName === "Bel Air Community")?.bookings).toBe(2);
    expect(tallies.find((t) => t.groupName === "Fallston Chat")?.bookings).toBe(1);
  });

  it("works out a rate, for comparing six posts with sixty", () => {
    const tallies = tallyByGroup(rows, ["a1", "a2"]);
    expect(tallies.find((t) => t.groupName === "Bel Air Community")?.rate).toBeCloseTo(2 / 3, 6);
  });

  it("orders by bookings, not by rate", () => {
    // One booking from twenty posts beats a perfect record from one, and a
    // rate on a single post is not a rate.
    const many = [
      ...Array.from({ length: 20 }, (_, i) => row({ code: `m${i}`, groupName: "Big Group" })),
      row({ code: "solo", groupName: "Tiny Group" }),
    ];
    const tallies = tallyByGroup(many, ["m0", "m1", "solo"]);
    expect(tallies[0].groupName).toBe("Big Group");
  });

  it("still counts a reply nobody labelled", () => {
    const tallies = tallyByGroup([row({ groupName: null })], []);
    expect(tallies[0].posts).toBe(1);
    expect(tallies[0].groupName).toContain("no group named");
  });

  it("has nothing to say about nothing", () => {
    expect(tallyByGroup([], [])).toEqual([]);
  });
});

describe("who has answered the most", () => {
  it("counts posts and what came of them, per person", () => {
    const rows = [
      row({ code: "x1", profileId: "travis" }),
      row({ code: "x2", profileId: "travis" }),
      row({ code: "y1", profileId: "jace" }),
    ];
    const tallies = tallyByPerson(rows, ["x1"]);
    expect(tallies[0]).toEqual({ profileId: "travis", posts: 2, bookings: 1 });
    expect(tallies[1]).toEqual({ profileId: "jace", posts: 1, bookings: 0 });
  });
});
