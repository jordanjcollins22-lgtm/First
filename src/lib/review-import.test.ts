import { describe, expect, it } from "vitest";

import { describePull, keepReview, pullDue, reviewKey, reviewSourceFrom } from "./review-import";

describe("the links pasted in", () => {
  it("turns a Facebook page into its Reviews tab", () => {
    expect(reviewSourceFrom("https://www.facebook.com/jslandscapingmd?mibextid=abc")).toEqual({
      ok: true,
      platform: "facebook",
      url: "https://www.facebook.com/jslandscapingmd",
      reviewsUrl: "https://www.facebook.com/jslandscapingmd/reviews",
    });
    expect(reviewSourceFrom("facebook.com/profile.php?id=61550000000000")).toMatchObject({
      ok: true,
      reviewsUrl: "https://www.facebook.com/profile.php?id=61550000000000&sk=reviews",
    });
    expect(reviewSourceFrom("https://www.facebook.com/groups/harford/posts/1")).toMatchObject({ ok: false });
  });

  it("opens a Google Maps link as it is", () => {
    expect(reviewSourceFrom("https://maps.app.goo.gl/AbC123")).toMatchObject({ ok: true, platform: "google" });
    expect(reviewSourceFrom("https://www.google.com/maps/place/JS+Landscaping/@39.5,-76.3")).toMatchObject({ ok: true, platform: "google" });
    expect(reviewSourceFrom("https://www.google.com/search?q=js+landscaping")).toMatchObject({ ok: false });
  });

  it("says why Instagram and anything else can't be pulled", () => {
    expect(reviewSourceFrom("https://instagram.com/jslandscaping")).toMatchObject({ ok: false, error: expect.stringMatching(/Instagram/) });
    expect(reviewSourceFrom("https://yelp.com/biz/x")).toMatchObject({ ok: false });
    expect(reviewSourceFrom("")).toMatchObject({ ok: false });
  });
});

describe("which reviews go on the page", () => {
  const r = (over: Partial<Parameters<typeof keepReview>[1]>) => ({
    author: "Jill M.",
    text: "They did a great job on our yard",
    stars: 5,
    recommends: null,
    when: null,
    ...over,
  });
  it("only five stars, with something written", () => {
    expect(keepReview("google", r({}))).toBe(true);
    expect(keepReview("google", r({ stars: 4 }))).toBe(false);
    expect(keepReview("google", r({ stars: 1 }))).toBe(false);
    expect(keepReview("google", r({ text: "" }))).toBe(false);
    expect(keepReview("google", r({ stars: null }))).toBe(false);
  });
  it("counts a Facebook recommendation, never a 'doesn't recommend'", () => {
    expect(keepReview("facebook", r({ stars: null, recommends: true }))).toBe(true);
    expect(keepReview("facebook", r({ stars: null, recommends: false }))).toBe(false);
    expect(keepReview("facebook", r({ stars: 5, recommends: false }))).toBe(false);
  });
  it("knows the same review however it was read", () => {
    expect(reviewKey("google", { author: "Jill M.", text: "Great job!!" })).toBe(reviewKey("google", { author: "jill m", text: "great job" }));
  });
});

describe("when a page is read again", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("when asked, when never read, or after a week", () => {
    expect(pullDue({ pullRequestedAt: null, pulledAt: null }, now)).toBe(true);
    expect(pullDue({ pullRequestedAt: "2026-09-26T11:00:00Z", pulledAt: "2026-09-25T00:00:00Z" }, now)).toBe(true);
    expect(pullDue({ pullRequestedAt: "2026-09-24T11:00:00Z", pulledAt: "2026-09-25T00:00:00Z" }, now)).toBe(false);
    expect(pullDue({ pullRequestedAt: null, pulledAt: "2026-09-18T00:00:00Z" }, now)).toBe(true);
  });
  it("says what it found", () => {
    expect(describePull(14, 9, 6)).toBe("Found 14 reviews, 9 five-star with something written, 6 new.");
    expect(describePull(0, 0, 0)).toMatch(/No reviews found/);
  });
});
