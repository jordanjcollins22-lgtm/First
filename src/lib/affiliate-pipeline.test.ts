import { describe, expect, it } from "vitest";

import { affiliatePipeline, linkStage, whereLabel } from "./affiliate-pipeline";

const row = (over: Record<string, unknown>) => ({
  id: "r",
  code: "abc",
  kind: "comment" as const,
  platform: "facebook" as const,
  audience: "Bel Air Moms",
  fromPage: null,
  sentTo: null,
  profileId: "p",
  postedAt: "2026-09-10T12:00:00Z",
  clickCount: 0,
  response: null,
  ...over,
});

describe("linkStage", () => {
  it("is the furthest point the link reached", () => {
    expect(linkStage(row({}), [])).toBe("posted");
    expect(linkStage(row({ clickCount: 3 }), [])).toBe("opened");
    expect(linkStage(row({ clickCount: 3, response: "replied" }), [])).toBe("answered");
    expect(linkStage(row({ response: "replied" }), [{ converted: false }])).toBe("booked");
    expect(linkStage(row({}), [{ converted: false }, { converted: true }])).toBe("closed");
  });

  it("puts a no at the end of the line, unless they booked anyway", () => {
    expect(linkStage(row({ clickCount: 2, response: "not interested" }), [])).toBe("declined");
    expect(linkStage(row({ response: "hostile" }), [])).toBe("declined");
    expect(linkStage(row({ response: "not interested" }), [{ converted: false }])).toBe("booked");
  });
});

describe("whereLabel", () => {
  it("says where the link went in words", () => {
    expect(whereLabel(row({}))).toBe("Bel Air Moms on Facebook");
    expect(whereLabel(row({ kind: "dm", audience: null, sentTo: "Kara T." }))).toBe("to Kara T. on Instagram".replace("Instagram", "Facebook"));
    expect(whereLabel(row({ audience: null, fromPage: "JS Landscaping" }))).toBe("Facebook, from JS Landscaping");
    expect(whereLabel(row({ audience: null }))).toBe("Facebook");
  });
});

describe("affiliatePipeline", () => {
  it("lists newest first with the people who booked", () => {
    const lines = affiliatePipeline(
      [row({ id: "old", code: "a", postedAt: "2026-09-01T00:00:00Z" }), row({ id: "new", code: "b", postedAt: "2026-09-12T00:00:00Z", clickCount: 1 })],
      { b: [{ jobId: "j", name: "Linda", converted: true, collected: 2115, commissionEarned: 105.75, commissionPaidOut: 0 }] }
    );
    expect(lines.map((l) => [l.id, l.stage, l.bookings.length])).toEqual([
      ["new", "closed", 1],
      ["old", "posted", 0],
    ]);
    expect(lines[0].where).toBe("Bel Air Moms on Facebook");
    expect(lines[0].kindLabel).toBe("Comment on a post");
  });
});
