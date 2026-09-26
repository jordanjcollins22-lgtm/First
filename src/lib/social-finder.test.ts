import { describe, expect, it } from "vitest";

import { ageInDays, cleanLink, platformOfLink, postKeyForLink, cleanSubreddit, matchReason, parseRedditListing, postedAtFromAge, redditNewPath, subredditIsLocal } from "./social-finder";

const keywords = ["lawn", "mow", "landscap", "mulch"];
const areaWords = ["bel air", "abingdon", "harford"];

describe("matchReason", () => {
  it("says which work words and which place", () => {
    const v = matchReason({ text: "Need someone to mow my lawn in Bel Air this week", keywords, areaWords, needArea: true });
    expect(v.matched).toBe(true);
    expect(v.reason).toBe("Mentions “lawn”, “mow”, in Bel Air");
  });
  it("needs a place when the source is not local", () => {
    expect(matchReason({ text: "Looking for a landscaper in Denver", keywords, areaWords, needArea: true }).matched).toBe(false);
    expect(matchReason({ text: "Looking for a landscaper", keywords, areaWords, needArea: false }).matched).toBe(true);
  });
  it("keeps nothing that does not name the work", () => {
    const v = matchReason({ text: "Best pizza in Bel Air?", keywords, areaWords, needArea: false });
    expect(v).toMatchObject({ matched: false, reason: null });
  });
});

describe("post times", () => {
  it("works out when a post went up from its age", () => {
    const readAt = new Date("2026-09-26T12:00:00Z");
    expect(postedAtFromAge(2, readAt)?.toISOString()).toBe("2026-09-24T12:00:00.000Z");
    expect(postedAtFromAge(null, readAt)).toBeNull();
    expect(ageInDays(new Date("2026-09-24T12:00:00Z"), readAt)).toBe(2);
  });
});

describe("Reddit", () => {
  it("cleans a subreddit name and refuses anything else", () => {
    expect(cleanSubreddit("r/HarfordCounty")).toBe("HarfordCounty");
    expect(cleanSubreddit("/r/baltimore/")).toBe("baltimore");
    expect(cleanSubreddit("../etc")).toBeNull();
    expect(redditNewPath("baltimore")).toBe("/r/baltimore/new.json?limit=50&raw_json=1");
  });

  it("knows a local subreddit by its name", () => {
    expect(subredditIsLocal("harfordcounty", ["harford", "bel air"])).toBe(true);
    expect(subredditIsLocal("BelAir", ["harford", "bel air"])).toBe(true);
    expect(subredditIsLocal("maryland", ["harford", "bel air"])).toBe(false);
  });

  it("reads a listing into found posts, skipping the removed and the malformed", () => {
    const listing = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc123",
              permalink: "/r/harfordcounty/comments/abc123/need_a_landscaper/",
              title: "Need a landscaper in Bel Air",
              selftext: "Front beds need mulch.",
              author: "neighbour1",
              subreddit: "harfordcounty",
              created_utc: 1790400000,
            },
          },
          { kind: "t3", data: { id: "gone", permalink: "/r/x/comments/gone/", title: "x", selftext: "[removed]" } },
          { kind: "t3", data: { title: "no id" } },
          { kind: "t1", data: { id: "comment" } },
        ],
      },
    };
    const posts = parseRedditListing(listing);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      platform: "reddit",
      key: "reddit:abc123",
      url: "https://www.reddit.com/r/harfordcounty/comments/abc123/need_a_landscaper/",
      author: "u/neighbour1",
      where: "r/harfordcounty",
      text: "Need a landscaper in Bel Air\n\nFront beds need mulch.",
    });
    expect(posts[0].postedAt?.toISOString()).toBe(new Date(1790400000 * 1000).toISOString());
    expect(parseRedditListing(null)).toEqual([]);
    expect(parseRedditListing({ error: 403 })).toEqual([]);
  });
});

describe("links pasted in", () => {
  it("knows the platform", () => {
    expect(platformOfLink("https://www.facebook.com/share/p/1Abc/")).toBe("facebook");
    expect(platformOfLink("https://nextdoor.com/p/AbC123")).toBe("nextdoor");
    expect(platformOfLink("https://www.reddit.com/r/harfordcounty/comments/abc123/x/")).toBe("reddit");
  });
  it("keys the same post the same however it was shared", () => {
    expect(postKeyForLink("https://www.facebook.com/groups/harfordhappenings/posts/123/?mibextid=abc")).toBe("harfordhappenings/123");
    expect(postKeyForLink("https://m.facebook.com/groups/harfordhappenings/permalink/123/")).toBe("harfordhappenings/123");
    expect(postKeyForLink("https://www.facebook.com/share/p/1AbCdEf/?mibextid=wwXIfr")).toBe("fb-share:1AbCdEf");
    expect(postKeyForLink("https://www.reddit.com/r/harfordcounty/comments/ABC123/need/")).toBe("reddit:abc123");
    expect(postKeyForLink("https://nextdoor.com/p/AbC123?utm_source=share")).toBe("nextdoor:AbC123");
    expect(postKeyForLink("not a link")).toBeNull();
  });
  it("takes the tracking off a link", () => {
    expect(cleanLink("https://www.facebook.com/share/p/1Ab/?mibextid=wwXIfr&utm_source=x")).toBe("https://www.facebook.com/share/p/1Ab/");
  });
});
