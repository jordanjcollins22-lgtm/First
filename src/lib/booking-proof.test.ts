import { describe, expect, it } from "vitest";

import { landingBadges, landingHeadline, promisesKept, serviceFromLink, showcaseTitleFromCaption, type BookingProof } from "./booking-proof";

const review = (id: string) => ({ id, author: "Ann", body: "Great job", stars: 5, source: "Google", writtenOn: null });
const news = { id: "n", outlet: "WBAL", headline: "Local landscaper", url: "https://example.com" };

describe("what the landing card says", () => {
  it("claims only what has something behind it", () => {
    const none: BookingProof = { reviews: [], news: [], showcase: [] };
    expect(landingBadges(none)).toEqual(["Free evaluation", "Book in under 5 minutes"]);
    expect(landingBadges({ reviews: [review("a")], news: [], showcase: [] })).not.toContain("Amazing reviews");
    expect(landingBadges({ reviews: [review("a"), review("b")], news: [news], showcase: [] })).toEqual([
      "Featured in the news",
      "Amazing reviews",
      "Free evaluation",
      "Book in under 5 minutes",
    ]);
  });

  it("tells the owner which promises the page can't back yet", () => {
    const kept = promisesKept({ reviews: [review("a")], news: [], showcase: [] });
    expect(kept.find((p) => p.promise === "Featured in the news")).toMatchObject({ kept: false });
    expect(kept.find((p) => p.promise === "Amazing reviews")).toMatchObject({ kept: false, how: "Add at least one more review" });
    expect(promisesKept({ reviews: [review("a"), review("b")], news: [news], showcase: [] }).every((p) => p.kept)).toBe(true);
  });

  it("names the work the person asked about", () => {
    expect(serviceFromLink("Lawn Care", null)).toBe("Lawn Care");
    expect(serviceFromLink(null, "Lawn Care — Needs grass cut today.")).toBe("Lawn Care");
    expect(serviceFromLink(null, "Looking for a licensed tree removal service recommendation.")).toBeNull();
    expect(serviceFromLink(null, null)).toBeNull();
    expect(landingHeadline("Lawn Care")).toBe("Let's get your lawn care taken care of");
    expect(landingHeadline(null)).toBe("Let's take a look at your property");
  });
});

describe("before and afters", () => {
  it("titles a studio post by its work", () => {
    expect(showcaseTitleFromCaption("Mulching in Maryland 21009 —\n\nFree estimates", "Zone 2")).toBe("Mulching");
    expect(showcaseTitleFromCaption(null, "Front beds")).toBe("Front beds");
    expect(showcaseTitleFromCaption("", null)).toBe("A recent job");
  });
});
