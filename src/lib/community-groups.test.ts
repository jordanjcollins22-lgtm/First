import { describe, expect, it } from "vitest";

import {
  adminAssistPlan,
  declineMessage,
  dollars,
  matchedBlockWords,
  passExpiry,
  passIsGood,
  passStatusLabel,
  tallyGroups,
  triageLocally,
  urgencyRank,
} from "@/lib/community-groups";

describe("matchedBlockWords", () => {
  it("catches a business advertising itself", () => {
    const hits = matchedBlockWords("Licensed and insured! Free estimates, DM for pricing.");
    expect(hits).toContain("licensed and insured");
    expect(hits).toContain("free estimates");
  });

  it("ignores punctuation and case, so a real post is still caught", () => {
    expect(matchedBlockWords("NOW BOOKING -- spring cleanups")).toContain("now booking");
  });

  it("leaves a neighbour asking for help alone", () => {
    expect(matchedBlockWords("Does anyone know someone who can mulch my beds?")).toEqual([]);
  });

  it("takes the group's own words on top of the standard list", () => {
    expect(matchedBlockWords("Best crab cakes in Bel Air", ["crab cakes"])).toContain("crab cakes");
  });

  it("does not match a word buried inside another one", () => {
    // "discount" is on the list; "discounted" is not the same claim and a
    // neighbour saying it is not advertising.
    expect(matchedBlockWords("I got mine discounted last year")).toEqual([]);
  });
});

describe("triageLocally", () => {
  const services = ["Lawn Care", "Leaf / Seasonal Cleanup", "Landscape Bed"];

  it("reads somebody asking for work as a request", () => {
    const out = triageLocally("Looking for someone to do a leaf cleanup before the weekend", { services });
    expect(out.kind).toBe("request");
    expect(out.service).toBe("Leaf / Seasonal Cleanup");
    expect(out.urgency).toBe("soon");
  });

  it("calls an advert an advert even when it names a service", () => {
    const out = triageLocally("Now booking lawn care for spring, licensed and insured", { services });
    expect(out.kind).toBe("promotion");
    expect(out.service).toBeNull();
  });

  it("leaves ordinary chatter alone", () => {
    expect(triageLocally("Lovely sunset over the park tonight", { services }).kind).toBe("other");
  });

  it("hears urgency when they say it is urgent", () => {
    const out = triageLocally("Need someone ASAP, tree came down on the fence", { services });
    expect(out.urgency).toBe("emergency");
  });

  it("gives no service rather than a wrong one", () => {
    const out = triageLocally("Looking for someone to fix my roof", { services });
    expect(out.kind).toBe("request");
    expect(out.service).toBeNull();
  });
});

describe("urgencyRank", () => {
  it("puts the soonest first and the unsaid last", () => {
    expect(urgencyRank("emergency")).toBeLessThan(urgencyRank("soon"));
    expect(urgencyRank("whenever")).toBeLessThan(urgencyRank(null));
  });
});

describe("declineMessage", () => {
  const group = { name: "Bel Air South", businessPostCents: 2500, passDays: 30, declineMessage: null };

  it("says the price and where to pay", () => {
    const message = declineMessage(group, "https://example.com/promote/abc");
    expect(message).toContain("$25");
    expect(message).toContain("https://example.com/promote/abc");
  });

  it("just says no when business posts are not for sale", () => {
    const message = declineMessage({ ...group, businessPostCents: null }, null);
    expect(message).toContain("neighbours");
    expect(message).not.toContain("$");
  });

  it("keeps the owner's own wording and adds the link to it", () => {
    const message = declineMessage(
      { ...group, declineMessage: "No business posts, sorry." },
      "https://example.com/pay"
    );
    expect(message).toContain("No business posts, sorry.");
    expect(message).toContain("https://example.com/pay");
  });

  it("does not add the link twice when it is already written in", () => {
    const custom = "Pay here: https://example.com/pay";
    const message = declineMessage({ ...group, declineMessage: custom }, "https://example.com/pay");
    expect(message.match(/https:\/\/example\.com\/pay/g)).toHaveLength(1);
  });
});

describe("adminAssistPlan", () => {
  it("hands over the words and the message, with the group's own words folded in", () => {
    const plan = adminAssistPlan(
      { name: "Bel Air South", businessPostCents: 2500, passDays: 30, declineMessage: null },
      ["crab cakes", "crab cakes"],
      "https://example.com/pay"
    );
    expect(plan.keywords).toContain("crab cakes");
    expect(plan.keywords.filter((word) => word === "crab cakes")).toHaveLength(1);
    expect(plan.declineMessage).toContain("$25");
    expect(plan.steps.length).toBeGreaterThan(2);
  });
});

describe("passes", () => {
  it("expires a pass the given number of days after it was paid", () => {
    const paid = new Date("2026-03-01T12:00:00Z");
    expect(passExpiry(paid, 30).toISOString()).toBe("2026-03-31T12:00:00.000Z");
  });

  it("only lets a paid, unexpired pass through", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    expect(passIsGood({ status: "paid", expiresAt: "2026-03-31T00:00:00Z" }, now)).toBe(true);
    expect(passIsGood({ status: "paid", expiresAt: "2026-03-01T00:00:00Z" }, now)).toBe(false);
    expect(passIsGood({ status: "unpaid", expiresAt: null }, now)).toBe(false);
  });

  it("says expired for a paid pass that has lapsed, whatever the row still says", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(passStatusLabel({ status: "paid", expiresAt: "2026-03-01T00:00:00Z" }, now)).toBe("Expired");
  });
});

describe("tallyGroups", () => {
  it("counts requests, unanswered ones, adverts and money per group", () => {
    const tallies = tallyGroups(
      [
        { groupId: "a", kind: "request", handledAt: null },
        { groupId: "a", kind: "request", handledAt: "2026-03-01T00:00:00Z" },
        { groupId: "a", kind: "promotion", handledAt: null },
        { groupId: "b", kind: "other", handledAt: null },
      ],
      [
        { groupId: "a", status: "paid", amountCents: 2500 },
        { groupId: "a", status: "used", amountCents: 2500 },
        { groupId: "a", status: "unpaid", amountCents: 9900 },
      ]
    );

    const a = tallies.get("a")!;
    expect(a.requests).toBe(2);
    expect(a.unanswered).toBe(1);
    expect(a.promotions).toBe(1);
    expect(a.earnedCents).toBe(5000);
    expect(tallies.get("b")!.other).toBe(1);
  });
});

describe("dollars", () => {
  it("drops the cents when there are none", () => {
    expect(dollars(2500)).toBe("$25");
    expect(dollars(2550)).toBe("$25.50");
  });
});
