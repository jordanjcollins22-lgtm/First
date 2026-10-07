import { describe, expect, it } from "vitest";

import { checkComment, LINK_MARKER, wordsComment } from "./comment-prompt";

const base = { roles: ["owner"], businessName: "JS Landscaping MD" };

describe("wordsComment", () => {
  it("names the work the post asks about, with the commenter's own opener and the link", () => {
    const c = wordsComment({ ...base, postText: "Looking for someone to mow and trim the bushes", seed: "a1" })!;
    expect(c).toMatch(/^I operate JS Landscaping MD\./);
    expect(c).toMatch(/lawn mowing/);
    expect(c).toMatch(/hedge and shrub trimming/);
    expect(c).toContain(LINK_MARKER);
  });

  it("only ever coordinates tree work, and passes every comment rule", () => {
    const c = wordsComment({ ...base, postText: "Need someone for tree removal and leaf cleanup", seed: "b2" })!;
    expect(c).toMatch(/coordinate it through our trusted contractor network/);
    expect(checkComment(c.split(LINK_MARKER).join("")).ok).toBe(true);
  });

  it("words different posts differently", () => {
    const texts = new Set(
      ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"].map((seed) => wordsComment({ ...base, postText: "Anyone know a lawn guy?", seed }))
    );
    expect(texts.size).toBeGreaterThan(2);
  });

  it("writes nothing for a post that names no yard work", () => {
    expect(wordsComment({ ...base, postText: "Can anyone recommend a dentist?", seed: "c3" })).toBeNull();
  });
});
