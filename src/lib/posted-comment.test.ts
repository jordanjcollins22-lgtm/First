import { describe, expect, it } from "vitest";

import { checkPosted, containsLink, postedSummary, postedVersion } from "@/lib/posted-comment";

const LINK = "https://app.jslandscapingmd.com/r/xxm3kw9";
const DRAFT =
  "Hi Dana, I run JS Landscaping MD here in Bel Air. We do beds, mulch and lawn restoration, and we can come out for a free walk-through. " +
  "Happy to take a look at the slope by the fence too. Book a time here: " +
  LINK;

describe("postedVersion", () => {
  it("recognises the draft posted as it was, whatever the spacing", () => {
    expect(postedVersion(DRAFT, DRAFT.replace(/\s+/g, "  ") + "\n")).toBe("as_written");
  });

  it("calls a trimmed draft edited", () => {
    const posted = DRAFT.replace("Happy to take a look at the slope by the fence too. ", "");
    expect(postedVersion(DRAFT, posted)).toBe("edited");
  });

  it("calls a rewrite their own words", () => {
    expect(postedVersion(DRAFT, `Hey! We'd love to help with this, here's our booking page ${LINK}`)).toBe("own");
  });

  it("is their own words when nothing was written for the post", () => {
    expect(postedVersion(null, "Anything at all")).toBe("own");
  });
});

describe("containsLink", () => {
  it("finds the link with or without the scheme and trailing slash", () => {
    expect(containsLink(`book here app.jslandscapingmd.com/r/xxm3kw9/ thanks`, LINK)).toBe(true);
    expect(containsLink(`book here ${LINK}`, LINK)).toBe(true);
    expect(containsLink("no link in this one", LINK)).toBe(false);
  });
});

describe("checkPosted", () => {
  it("passes a clean paste with the link in it", () => {
    const check = checkPosted({ draft: DRAFT, posted: DRAFT, link: LINK });
    expect(check).toEqual({ hasLink: true, problems: [], version: "as_written" });
    expect(postedSummary(check)).toBe("Posted as written.");
  });

  it("flags a missing link and a claim we cannot make, without refusing the record", () => {
    const posted = "We handle tree removal and we're fully licensed and insured. Message me!";
    const check = checkPosted({ draft: DRAFT, posted, link: LINK });
    expect(check.hasLink).toBe(false);
    expect(check.problems.length).toBeGreaterThan(0);
    expect(check.version).toBe("own");
    expect(postedSummary(check)).toMatch(/Your link is not in it/);
    expect(postedSummary(check)).toMatch(/Worth fixing on the post/);
  });
});
