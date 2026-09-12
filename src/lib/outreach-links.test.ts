import { describe, expect, it } from "vitest";

import {
  makeCode,
  bookingDestination,
  bookingRate,
  clickRate,
  goesToOnePerson,
  kindLabel,
  tallyByGroup,
  tallyByKind,
  tallyByPage,
  tallyByPerson,
  totals,
  trackedLink,
  type OutreachRow,
} from "@/lib/outreach-links";

describe("the code that goes in the link", () => {
  it("cannot be misread down a phone", () => {
    // These get typed by somebody squinting at a screenshot. No l, no 1, no
    // 0, no o.
    const codes = Array.from({ length: 200 }, () => makeCode());
    for (const code of codes) expect(code).not.toMatch(/[l1o0]/);
  });

  it("is short enough to live in a URL somebody reads out", () => {
    expect(makeCode()).toHaveLength(7);
  });

  it("is different every time", () => {
    const codes = new Set(Array.from({ length: 500 }, () => makeCode()));
    expect(codes.size).toBeGreaterThan(490);
  });

  it("uses the randomness it is handed, so a test can pin it", () => {
    expect(makeCode(() => 0)).toBe("aaaaaaa");
  });
});

describe("the link that gets pasted", () => {
  it("is short, and goes through us so the open is counted", () => {
    expect(trackedLink("https://app.jslandscapingmd.com", "kf3mq7z")).toBe(
      "https://app.jslandscapingmd.com/r/kf3mq7z"
    );
  });

  it("does not double the slash when the base ends in one", () => {
    expect(trackedLink("https://x.test/", "abc2345")).toBe("https://x.test/r/abc2345");
  });
});

describe("where a tracked link sends somebody", () => {
  it("names the business, credits the person and identifies the link", () => {
    const to = bookingDestination({
      baseUrl: "https://app.jslandscapingmd.com",
      orgSlug: "js-landscaping-md-00000000",
      affiliateSlug: "b49d3f3c5f",
      code: "kf3mq7z",
    });
    expect(to).toContain("org=js-landscaping-md-00000000");
    expect(to).toContain("ref=b49d3f3c5f");
    expect(to).toContain("rec=kf3mq7z");
    expect(to).toContain("/book?");
  });

  it("still names the business for somebody with no affiliate link of their own", () => {
    // This is the one that broke. A destination naming nobody gave the booking
    // page nothing to resolve, so the person posted "This booking link isn't
    // valid" into a stranger's thread.
    expect(
      bookingDestination({
        baseUrl: "https://x.test",
        orgSlug: "js-landscaping-md-00000000",
        affiliateSlug: null,
        code: "abc2345",
      })
    ).toBe("https://x.test/book?org=js-landscaping-md-00000000&rec=abc2345");
  });

  it("keeps the business on it as well as the person, not instead of them", () => {
    const to = bookingDestination({
      baseUrl: "https://x.test",
      orgSlug: "acme-1234",
      affiliateSlug: "b49d3f3c5f",
      code: "abc2345",
    });
    expect(to).toContain("org=acme-1234");
    expect(to).toContain("ref=b49d3f3c5f");
  });
});

describe("what carried the link", () => {
  it("knows a comment reaches a person and a post reaches a room", () => {
    expect(goesToOnePerson("comment")).toBe(true);
    expect(goesToOnePerson("dm")).toBe(true);
    expect(goesToOnePerson("post")).toBe(false);
    expect(goesToOnePerson("flyer")).toBe(false);
  });

  it("names something it does not recognise rather than showing a blank", () => {
    expect(kindLabel("telegram")).toBe("Something else");
  });
});

function row(over: Partial<OutreachRow> = {}): OutreachRow {
  return {
    id: over.code ?? "id",
    code: "aaa1111",
    kind: "comment",
    platform: "facebook",
    audience: "Bel Air Community",
    fromPage: null,
    sentTo: null,
    profileId: "p1",
    postedAt: "2026-03-01T00:00:00Z",
    clickCount: 0,
    response: null,
    ...over,
  };
}

describe("the funnel", () => {
  it("counts handed out, opened, answered and booked", () => {
    const funnel = totals(
      [
        row({ code: "a", clickCount: 3, response: "replied" }),
        row({ code: "b", clickCount: 1 }),
        row({ code: "c" }),
      ],
      ["a"]
    );
    expect(funnel.posts).toBe(3);
    expect(funnel.clicked).toBe(2);
    expect(funnel.clicks).toBe(4);
    expect(funnel.replied).toBe(1);
    expect(funnel.bookings).toBe(1);
  });

  it("counts one link opened five times as one opened link and five opens", () => {
    // Somebody coming back twice is not two people, and a room judged on total
    // opens would be judged on one curious neighbour.
    const funnel = totals([row({ code: "a", clickCount: 5 })], []);
    expect(funnel.clicked).toBe(1);
    expect(funnel.clicks).toBe(5);
  });

  it("withholds a rate below a handful, where it is noise not a rate", () => {
    const thin = totals([row({ code: "a", clickCount: 1 })], ["a"]);
    expect(bookingRate(thin)).toBeNull();
    expect(clickRate(thin)).toBeNull();
  });

  it("gives a rate once there is enough behind it", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ code: `c${i}`, clickCount: i < 4 ? 1 : 0 })
    );
    const funnel = totals(rows, ["c0", "c1"]);
    expect(clickRate(funnel)).toBeCloseTo(0.4);
    expect(bookingRate(funnel)).toBeCloseTo(0.2);
  });
});

describe("which rooms are worth being in", () => {
  it("counts by room, because 'Facebook works' is not something anybody can act on", () => {
    const tallies = tallyByGroup(
      [row({ code: "a", audience: "Bel Air Community" }), row({ code: "b", audience: "Fallston Chat" })],
      []
    );
    expect(tallies.map((t) => t.audience)).toEqual(["Bel Air Community", "Fallston Chat"]);
  });

  it("treats the same room typed two ways as one room", () => {
    const tallies = tallyByGroup(
      [row({ code: "a", audience: "Bel Air Community" }), row({ code: "b", audience: "bel air community" })],
      []
    );
    expect(tallies).toHaveLength(1);
    expect(tallies[0].posts).toBe(2);
  });

  it("still counts a link nobody labelled, under its platform", () => {
    const tallies = tallyByGroup([row({ code: "a", audience: null })], []);
    expect(tallies).toHaveLength(1);
    expect(tallies[0].audience).toContain("Facebook");
  });

  it("separates a room that never opens anything from one that opens and does not book", () => {
    // The whole reason clicks are counted. These two need opposite decisions.
    const quiet = Array.from({ length: 6 }, (_, i) => row({ code: `q${i}`, audience: "Quiet group" }));
    const busy = Array.from({ length: 6 }, (_, i) =>
      row({ code: `b${i}`, audience: "Busy group", clickCount: 2 })
    );
    const tallies = tallyByGroup([...quiet, ...busy], []);
    const byName = new Map(tallies.map((t) => [t.audience, t]));
    expect(clickRate(byName.get("Quiet group")!)).toBe(0);
    expect(clickRate(byName.get("Busy group")!)).toBe(1);
  });

  it("orders by bookings, because one booking from twenty beats a perfect record from one", () => {
    const many = Array.from({ length: 20 }, (_, i) => row({ code: `m${i}`, audience: "Twenty" }));
    const one = row({ code: "one", audience: "One" });
    const tallies = tallyByGroup([...many, one], ["m0", "one"]);
    expect(tallies[0].audience).toBe("Twenty");
  });
});

describe("who handed them out", () => {
  it("counts what came back per person", () => {
    const tallies = tallyByPerson(
      [
        row({ code: "a", profileId: "p1", clickCount: 1 }),
        row({ code: "b", profileId: "p1" }),
        row({ code: "c", profileId: "p2" }),
      ],
      ["a"]
    );
    expect(tallies[0]).toMatchObject({ profileId: "p1", posts: 2, clicked: 1, bookings: 1 });
  });
});

describe("what works", () => {
  it("counts a post apart from a comment, because they reach different numbers of people", () => {
    const tallies = tallyByKind(
      [row({ code: "a", kind: "post" }), row({ code: "b", kind: "comment" }), row({ code: "c", kind: "comment" })],
      ["b"]
    );
    const byKind = new Map(tallies.map((t) => [t.kind, t]));
    expect(byKind.get("comment")!.posts).toBe(2);
    expect(byKind.get("post")!.posts).toBe(1);
  });

  it("counts our own pages, and ignores anything that named none", () => {
    // A shop with one page and no scheduling should see nothing here, rather
    // than a row called "unknown" with every comment in it.
    const tallies = tallyByPage(
      [row({ code: "a", kind: "post", fromPage: "JS Landscaping MD" }), row({ code: "b", fromPage: null })],
      []
    );
    expect(tallies).toHaveLength(1);
    expect(tallies[0].page).toBe("JS Landscaping MD");
  });
});
