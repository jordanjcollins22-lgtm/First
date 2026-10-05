import { describe, expect, it } from "vitest";

import { readsReviews, runningComputers, shareFor, type FinderComputer } from "@/lib/finder-fleet";

const FEED = "https://www.facebook.com/groups/feed/";
const now = new Date("2026-10-05T12:00:00Z");
const pc = (id: string, first: string, seenMinutesAgo: number, profileId: string | null = null): FinderComputer => ({
  id,
  profileId,
  firstSeenAt: first,
  lastSeenAt: new Date(now.getTime() - seenMinutesAgo * 60_000).toISOString(),
});

const settings = {
  groups: [{ url: FEED, name: "your groups feed" }, { url: "g1" }, { url: "g2" }, { url: "g3" }],
  searchPhrases: ["a", "b", "c", "d", "e"],
  searches: ["a", "b", "c", "d", "e"].map((phrase) => ({ phrase, url: `s/${phrase}` })),
  sources: { feed: true, search: true, list: true },
};

describe("runningComputers", () => {
  it("keeps those checking in, oldest first", () => {
    const list = runningComputers([pc("b", "2026-10-02", 1), pc("a", "2026-10-01", 2), pc("c", "2026-10-03", 10)], now);
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("shareFor", () => {
  it("gives one computer everything", () => {
    const out = shareFor(settings, [{ id: "a" }], "a", FEED);
    expect(out.searchPhrases).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.groups.map((g) => g.url)).toEqual([FEED, "g1", "g2", "g3"]);
    expect(out.share).toEqual({ place: 1, of: 1 });
  });

  it("deals searches and listed groups between two, and both keep the groups feed", () => {
    const first = shareFor(settings, [{ id: "a" }, { id: "b" }], "a", FEED);
    const second = shareFor(settings, [{ id: "a" }, { id: "b" }], "b", FEED);
    expect(first.searchPhrases).toEqual(["a", "c", "e"]);
    expect(second.searchPhrases).toEqual(["b", "d"]);
    expect(first.groups.map((g) => g.url)).toEqual([FEED, "g1", "g3"]);
    expect(second.groups.map((g) => g.url)).toEqual([FEED, "g2"]);
    expect(second.share).toEqual({ place: 2, of: 2 });
  });

  it("counts a computer not yet on the list as joining at the end", () => {
    expect(shareFor(settings, [{ id: "a" }], "new", FEED).share).toEqual({ place: 2, of: 2 });
  });
});

describe("readsReviews", () => {
  it("is the first running computer signed in as an owner", () => {
    const running = [pc("crew", "2026-10-01", 1, "p-crew"), pc("owner-pc", "2026-10-02", 1, "p-owner"), pc("owner-mac", "2026-10-03", 1, "p-owner")];
    const owners = new Set(["p-owner"]);
    expect(readsReviews(running, "owner-pc", owners)).toBe(true);
    expect(readsReviews(running, "owner-mac", owners)).toBe(false);
  });
});
