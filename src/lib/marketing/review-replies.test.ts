import { describe, expect, it } from "vitest";

import { belongsOnBookingPage, fallbackReply, firstName, replyPolicy, replyProblems, reviewStats, shouldDraft } from "./review-replies";

describe("review replies", () => {
  it("posts 4-5 stars and holds the rest for a person", () => {
    expect(replyPolicy(5)).toBe("auto");
    expect(replyPolicy(4)).toBe("auto");
    expect(replyPolicy(3)).toBe("hold");
    expect(replyPolicy(1)).toBe("hold");
    expect(replyPolicy(null)).toBe("hold");
  });

  it("uses a first name only", () => {
    expect(firstName("Kara Thompson")).toBe("Kara");
    expect(firstName("A Google User")).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it("refuses drafts that offer money, give contact details, mention software or use a last name", () => {
    const review = { author: "Kara Thompson", stars: 2, body: "Late." };
    expect(replyProblems("Thank you, Kara. We are sorry about the delay and want to make it right.", review)).toEqual([]);
    expect(replyProblems("Sorry Kara, here is a 20% off coupon for next time.", review)).toContain("Offers money or a discount.");
    expect(replyProblems("Call us at 443-819-1521 so we can fix it, Kara.", review)).toContain("Includes a phone number, email or link.");
    expect(replyProblems("Thank you Ms Thompson for the review, we appreciate it.", review)).toContain("Uses the reviewer's last name.");
    expect(replyProblems("This automated reply thanks you for the review.", review)).toContain("Mentions software.");
    expect(replyProblems("Thanks!", review)).toContain("Too short.");
  });

  it("has a template for both kinds that passes its own check", () => {
    const good = { author: "Kara Thompson", stars: 5, body: "Great job" };
    const bad = { author: "Kara Thompson", stars: 1, body: "Never showed" };
    expect(replyProblems(fallbackReply(good, "JS Landscaping"), good)).toEqual([]);
    expect(replyProblems(fallbackReply(bad, "JS Landscaping"), bad)).toEqual([]);
    expect(fallbackReply(bad, "JS Landscaping")).toMatch(/make it right/);
  });

  it("only drafts for reviews after replies were switched on, and never twice", () => {
    expect(shouldDraft({ reviewedAt: "2026-10-14T00:00:00Z", updatedAt: null, hasReply: false, startedAt: "2026-10-13T00:00:00Z" })).toBe(true);
    expect(shouldDraft({ reviewedAt: "2026-01-01T00:00:00Z", updatedAt: null, hasReply: false, startedAt: "2026-10-13T00:00:00Z" })).toBe(false);
    expect(shouldDraft({ reviewedAt: "2026-10-14T00:00:00Z", updatedAt: null, hasReply: true, startedAt: "2026-10-13T00:00:00Z" })).toBe(false);
    expect(shouldDraft({ reviewedAt: "2026-10-14T00:00:00Z", updatedAt: null, hasReply: false, startedAt: null })).toBe(false);
  });

  it("puts good reviews with words on the booking page", () => {
    expect(belongsOnBookingPage({ author: "K", stars: 5, body: "They did a wonderful job on the beds." })).toBe(true);
    expect(belongsOnBookingPage({ author: "K", stars: 5, body: "Great" })).toBe(false);
    expect(belongsOnBookingPage({ author: "K", stars: 3, body: "They did an okay job on the beds overall." })).toBe(false);
  });

  it("counts rating, recent and answered", () => {
    const s = reviewStats(
      [
        { stars: 5, reviewedAt: "2026-10-10T00:00:00Z", replied: true },
        { stars: 4, reviewedAt: "2026-08-01T00:00:00Z", replied: false },
      ],
      new Date("2026-10-13T00:00:00Z")
    );
    expect(s).toMatchObject({ count: 2, average: 4.5, last30: 1, responded: 1, responseRate: 0.5 });
  });
});
