import { describe, expect, it } from "vitest";

import {
  checkComment,
  commentBrief,
  commentSystemPrompt,
  finishComment,
  LINK_MARKER,
  looksUsable,
} from "@/lib/comment-prompt";

const LINK = "https://app.jslandscapingmd.com/book?ref=abc&rec=kf3mq7z";

describe("the brief given to the model", () => {
  const prompt = commentSystemPrompt("J's Landscaping Services");

  it("names the business the comment is for", () => {
    expect(prompt).toContain("J's Landscaping Services");
  });

  it("carries the owner's own rules", () => {
    expect(prompt).toContain("amazing reviews");
    expect(prompt).toContain("help coordinate");
    expect(prompt).toMatch(/no em dashes/i);
    expect(prompt).toMatch(/only the finished comment/i);
  });

  it("forbids the claim the owner asked never to make", () => {
    expect(prompt).toMatch(/never say "only five-star reviews"/i);
  });

  it("asks for the placeholder rather than a URL", () => {
    // A model asked for a link will sooner or later invent one.
    expect(prompt).toContain(LINK_MARKER);
    expect(prompt).not.toContain("http");
  });

  it("gives both openings, so the model picks by how old the post looks", () => {
    expect(prompt).toContain("If you haven't gotten this taken care of yet");
    expect(prompt).toMatch(/otherwise open with/i);
  });

  it("copes with a business with no name", () => {
    expect(commentSystemPrompt("  ")).toContain("our company");
  });
});

describe("what else the model is told", () => {
  it("passes on the group and the note when there are any", () => {
    const brief = commentBrief({ businessName: "J's", note: "wants a retaining wall", where: "Bel Air" });
    expect(brief).toContain("Bel Air");
    expect(brief).toContain("retaining wall");
  });

  it("says nothing about fields nobody filled in", () => {
    const brief = commentBrief({ businessName: "J's", note: "  ", where: "" });
    expect(brief).not.toMatch(/posted in:|we know about it:/i);
  });
});

describe("finishing the comment", () => {
  it("puts the real link where the placeholder was", () => {
    const out = finishComment(`I operate J's. Book here:\n\n${LINK_MARKER}\n\nHappy to help!`, LINK);
    expect(out).toContain(LINK);
    expect(out).not.toContain(LINK_MARKER);
  });

  it("adds the link when the model forgot the placeholder", () => {
    // A comment with no link does nothing at all, which is worse than an
    // untidy one.
    const out = finishComment("I operate J's and we can help with that.", LINK);
    expect(out).toContain(LINK);
  });

  it("does not add the link twice when it is already there", () => {
    const out = finishComment(`Book here: ${LINK}`, LINK);
    expect(out.split(LINK)).toHaveLength(2);
  });

  it("strips a preamble the model could not resist", () => {
    expect(finishComment("Here's the comment:\nI operate J's.", LINK)).toMatch(/^I operate/);
    expect(finishComment("Comment: I operate J's.", LINK)).toMatch(/^I operate/);
  });

  it("strips wrapping quotes and code fences", () => {
    expect(finishComment('"I operate J\'s."', LINK)).toMatch(/^I operate/);
    expect(finishComment("```\nI operate J's.\n```", LINK)).toMatch(/^I operate/);
  });

  it("never lets a five-star claim through", () => {
    // Enforced twice on purpose: the prompt asks, and this makes sure. It is
    // a claim somebody could be held to.
    expect(finishComment("We have only five-star reviews.", LINK)).toContain("amazing reviews");
    expect(finishComment("We have only 5-star reviews.", LINK)).toContain("amazing reviews");
    expect(finishComment("We have 5 star reviews.", LINK)).toContain("amazing reviews");
    expect(finishComment("We have five-star reviews.", LINK)).not.toMatch(/five-star/i);
  });

  it("takes out em dashes, because the owner asked", () => {
    const out = finishComment("We do lawns — and beds — all season.", LINK);
    expect(out).not.toContain("—");
    expect(out).toContain("We do lawns, and beds, all season.");
  });

  it("does not leave a wall of blank lines", () => {
    expect(finishComment(`One.\n\n\n\nTwo.\n\n${LINK_MARKER}`, LINK)).not.toMatch(/\n{3,}/);
  });

  it("copes with nothing at all", () => {
    expect(finishComment("", LINK)).toBe(LINK);
  });
});

describe("whether it is worth showing somebody", () => {
  it("accepts a real comment", () => {
    const good = finishComment(`I operate J's Landscaping and we can take care of that for you. ${LINK_MARKER}`, LINK);
    expect(looksUsable(good, LINK)).toBe(true);
  });

  it("rejects a link with nothing round it", () => {
    expect(looksUsable(LINK, LINK)).toBe(false);
  });

  it("rejects something with no link in it", () => {
    expect(looksUsable("I operate J's Landscaping and we would be glad to help you out here.", LINK)).toBe(false);
  });
});

/**
 * A real comment that went out. The business does not do tree work and is not
 * licensed for it, and the comment said both. It was written because "match
 * the exact service requested in the post" was the only instruction the brief
 * gave about services, so the model agreed with the post.
 */
const WENT_OUT =
  "I operate J's Landscaping Services LLC. We've been featured in the news, have amazing reviews, " +
  "and we handle tree and mulberry removal, and we're fully licensed and insured. " +
  "Happy to take a look!";

describe("checkComment", () => {
  it("catches the comment that actually went out", () => {
    const check = checkComment(WENT_OUT);
    expect(check.ok).toBe(false);
    expect(check.problems).toHaveLength(2);
  });

  it("names tree work as the trade being claimed", () => {
    expect(checkComment("We handle tree removal.").problems[0]).toMatch(/tree work/i);
  });

  it("catches the licence claim on its own", () => {
    const check = checkComment("I operate a landscaping company and we're fully licensed and insured.");
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toMatch(/licensed or insured/i);
  });

  it("allows a restricted trade framed as somebody else's work", () => {
    // The useful answer to a neighbour who asked, and a true one.
    expect(
      checkComment("We can help coordinate tree removal through our trusted contractor network.").ok
    ).toBe(true);
  });

  it("allows saying a partner is licensed", () => {
    expect(
      checkComment("For that part we bring in a partner who is licensed and insured for it.").ok
    ).toBe(true);
  });

  it("does not let a coordination line elsewhere excuse a claim at the top", () => {
    const mixed =
      "We handle tree removal. Beds and mulch too. We can coordinate other work through our network.";
    expect(checkComment(mixed).ok).toBe(false);
  });

  it("catches stump grinding, which is the same trade by another name", () => {
    expect(checkComment("We do stump grinding as well.").ok).toBe(false);
  });

  it("catches the other licensed trades a post might ask for", () => {
    expect(checkComment("We do the electrical for the lighting.").ok).toBe(false);
    expect(checkComment("We handle plumbing for irrigation.").ok).toBe(false);
    expect(checkComment("We do roofing too.").ok).toBe(false);
  });

  it("leaves an ordinary landscaping comment alone", () => {
    const fine =
      "I operate J's Landscaping Services LLC. We've been featured in the news and have amazing " +
      "reviews. Bed work and mulch is most of what we do, and that hedge line is very doable. " +
      "Happy to take a look!";
    expect(checkComment(fine).ok).toBe(true);
    expect(checkComment(fine).problems).toEqual([]);
  });

  it("says so about an empty comment rather than passing it", () => {
    expect(checkComment("   ").ok).toBe(false);
  });

  it("reports one problem per thing to fix, not one per mention", () => {
    const twice = "We handle tree removal. We also do tree trimming.";
    expect(checkComment(twice).problems).toHaveLength(1);
  });
});

describe("looksUsable", () => {
  it("refuses a comment that claims a trade we do not do", () => {
    // The last gate before somebody copies it into Facebook.
    expect(looksUsable(`${WENT_OUT}\n\n${LINK}`, LINK)).toBe(false);
  });
});

describe("the brief", () => {
  it("tells the model what our own crew actually does", () => {
    const brief = commentBrief({
      businessName: "J's",
      note: "",
      where: "Bel Air Neighbors",
      ownServices: ["Landscape Bed", "Lawn Care"],
      partnerServices: ["Fence"],
    });
    expect(brief).toMatch(/Landscape Bed, Lawn Care/);
    expect(brief).toMatch(/coordinate these through a partner: Fence/i);
  });

  it("tells the model to claim nothing when nobody told it the services", () => {
    // Silence about the service list used to mean the model agreed with the
    // post. It should mean the opposite.
    const prompt = commentSystemPrompt("J's");
    expect(prompt).toMatch(/do not claim any specific service at all/i);
  });

  it("forbids the licence claim outright", () => {
    expect(commentSystemPrompt("J's")).toMatch(/Never call J's licensed/i);
  });

  it("names tree work in the prompt, not only in the guard", () => {
    expect(commentSystemPrompt("J's")).toMatch(/tree removal/i);
  });
});
