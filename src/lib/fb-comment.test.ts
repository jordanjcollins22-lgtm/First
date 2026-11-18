import { describe, expect, it } from "vitest";

import { facebookComment } from "@/lib/fb-comment";

describe("facebookComment", () => {
  const base = { author: "sarah Miller", link: "https://app.jslandscapingmd.com/r/abc123", business: "JS Landscaping MD", from: "Jordan Collins", role: "owner" as const };

  it("is one line, so Enter doesn't post half of it", () => {
    expect(facebookComment(base)).not.toContain("\n");
  });

  it("says who the sender is by role and carries the tracked link", () => {
    const text = facebookComment(base);
    expect(text).toContain("I'm the owner of JS Landscaping MD");
    expect(text).toContain(base.link);
    expect(text.startsWith("Hi Sarah!")).toBe(true);
  });

  it("never promises free and never says the post was seen", () => {
    const text = facebookComment(base).toLowerCase();
    expect(text).not.toContain("free");
    expect(text).not.toContain("saw your post");
  });

  it("still greets when the name is unknown", () => {
    expect(facebookComment({ ...base, author: null }).startsWith("Hi there!")).toBe(true);
  });
});
