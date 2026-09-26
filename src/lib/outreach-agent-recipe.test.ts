import { describe, expect, it } from "vitest";

import { DEFAULT_RECIPE, EXTENSION_VERSION, versionIsBehind } from "./outreach-agent-recipe";

describe("versionIsBehind", () => {
  it("compares versions part by part", () => {
    expect(versionIsBehind("2.0.0", "2.1.0")).toBe(true);
    expect(versionIsBehind("2.1.0", "2.1.0")).toBe(false);
    expect(versionIsBehind("2.1.1", "2.1.0")).toBe(false);
    expect(versionIsBehind("2.1", "2.1.0")).toBe(false);
    expect(versionIsBehind("2.9.0", "2.10.0")).toBe(true);
    expect(versionIsBehind(null, EXTENSION_VERSION)).toBe(true);
  });
});

describe("the recipe", () => {
  it("only carries patterns that compile", () => {
    const patterns = [
      DEFAULT_RECIPE.scan.seeMoreText,
      DEFAULT_RECIPE.scan.postLink,
      DEFAULT_RECIPE.scan.groupLink,
      DEFAULT_RECIPE.scan.notGroupLink,
      DEFAULT_RECIPE.scan.profileLink,
      DEFAULT_RECIPE.scan.anonymous,
      DEFAULT_RECIPE.post.commentBoxLabel,
      DEFAULT_RECIPE.post.openCommentLabel,
      DEFAULT_RECIPE.post.joinButton,
      DEFAULT_RECIPE.post.blocked,
      DEFAULT_RECIPE.scan.shareButton,
      DEFAULT_RECIPE.scan.copyLinkText,
    ];
    for (const pattern of patterns) expect(() => new RegExp(pattern, "i")).not.toThrow();
    expect(new RegExp(DEFAULT_RECIPE.scan.postLink, "i").test("https://www.facebook.com/groups/123/posts/456/")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.groupLink, "i").test("https://www.facebook.com/groups/thisisaberdeen/")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.notGroupLink, "i").test("https://www.facebook.com/groups/feed/")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.anonymous, "i").test("Anonymous participant · 3h")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.post.blocked, "i").test("You're Temporarily Blocked")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.shareButton, "i").test("Share")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.shareButton, "i").test("Send this to friends or post it on your profile.")).toBe(true);
    expect(new RegExp(DEFAULT_RECIPE.scan.shareButton, "i").test("Share now (Public)")).toBe(false);
    expect(new RegExp(DEFAULT_RECIPE.scan.copyLinkText, "i").test("Copy link")).toBe(true);
  });
});
