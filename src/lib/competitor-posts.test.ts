import { describe, expect, it } from "vitest";

import { responseScore, summariseCompetitors, type CompetitorPost } from "@/lib/competitor-posts";

const post = (over: Partial<CompetitorPost>): CompetitorPost => ({
  id: "x",
  business: "Sample Lawn Co",
  group: "Harford Happenings",
  pitch: "services-list",
  reactions: null,
  comments: null,
  shares: null,
  text: "We do lawns",
  url: null,
  at: "2026-10-01T12:00:00Z",
  ...over,
});

describe("responseScore", () => {
  it("weights comments over reactions, and is null when nothing was counted", () => {
    expect(responseScore({ reactions: 10, comments: 2, shares: 1 })).toBe(18);
    expect(responseScore({ reactions: null, comments: null, shares: null })).toBeNull();
  });
});

describe("summariseCompetitors", () => {
  const s = summariseCompetitors([
    post({ id: "a", pitch: "before-after", reactions: 40, comments: 6 }),
    post({ id: "b", pitch: "before-after", reactions: 20, comments: 2, business: "Other Yard Co" }),
    post({ id: "c", pitch: "services-list", reactions: 3, comments: 0 }),
    post({ id: "d", pitch: "deal" }),
  ]);

  it("ranks pitches by the response they get, uncounted last", () => {
    expect(s.byPitch.map((p) => p.pitch)).toEqual(["before-after", "services-list", "deal"]);
    expect(s.byPitch[0]).toMatchObject({ posts: 2, counted: 2, avgReactions: 30, avgComments: 4 });
    expect(s.byPitch[0].best?.id).toBe("a");
    expect(s.byPitch[2]).toMatchObject({ posts: 1, counted: 0, avgComments: null });
  });

  it("lists the best-received posts and who posts most", () => {
    expect(s.top.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(s.busiest[0]).toMatchObject({ business: "Sample Lawn Co", posts: 3 });
    expect(s.counted).toBe(3);
  });
});
