import { describe, expect, it } from "vitest";

import {
  campaignMoves,
  centsText,
  clip,
  dateText,
  easternMorning,
  flyerRunMoves,
  mailingMoves,
  parsePageId,
  parseRate,
  playMoves,
  pmMoves,
  postMoves,
  prospectMoves,
  reviewMoves,
  statusLabel,
} from "./marketing-rules";

describe("words", () => {
  it("labels a status", () => {
    expect(statusLabel("not_interested")).toBe("Not interested");
    expect(statusLabel("")).toBe("—");
    expect(statusLabel(null)).toBe("—");
  });

  it("writes cents as dollars", () => {
    expect(centsText(1743)).toBe("$17.43");
    expect(centsText(2500)).toBe("$25");
    expect(centsText(null)).toBe("—");
  });

  it("writes a plain date as that day, whatever the time zone", () => {
    expect(dateText("2026-10-13")).toBe("Oct 13, 2026");
    expect(dateText(null)).toBe("—");
    expect(dateText("nonsense")).toBe("—");
  });

  it("clips long text to one line", () => {
    expect(clip("a\n\nb")).toBe("a b");
    expect(clip("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("easternMorning", () => {
  it("is 10am Eastern in summer time", () => {
    expect(easternMorning("2026-07-01")).toBe("2026-07-01T14:00:00.000Z");
  });
  it("is 10am Eastern in winter", () => {
    expect(easternMorning("2026-12-01")).toBe("2026-12-01T15:00:00.000Z");
  });
  it("refuses anything not a day", () => {
    expect(easternMorning("")).toBeNull();
    expect(easternMorning("tomorrow")).toBeNull();
  });
});

describe("what can be done", () => {
  it("moves a campaign along its life", () => {
    expect(campaignMoves("draft")).toEqual(["start"]);
    expect(campaignMoves("running")).toEqual(["pause", "stop"]);
    expect(campaignMoves("paused")).toEqual(["resume", "stop"]);
    expect(campaignMoves("done")).toEqual([]);
  });

  it("only asks to approve a pending play, and nothing once closed", () => {
    expect(playMoves({ status: "open", approval: "pending" })).toEqual(["approve", "assign", "done", "skip"]);
    expect(playMoves({ status: "open", approval: "approve" })).toEqual(["assign", "done", "skip"]);
    expect(playMoves({ status: "open", approval: null })).toContain("approve");
    expect(playMoves({ status: "done", approval: "approve" })).toEqual([]);
  });

  it("never offers to send a group post to the page", () => {
    expect(postMoves({ status: "scheduled", placement: "page" })).toEqual(["post_now", "mark_posted", "reschedule", "skip"]);
    expect(postMoves({ status: "draft", placement: "group" })).toEqual(["mark_posted", "reschedule", "skip"]);
    expect(postMoves({ status: "posted", placement: "page" })).toEqual([]);
  });

  it("follows the property-manager actions' own rules", () => {
    expect(pmMoves({ status: "drafted", email: "a@b.com", hasDrafts: true })).toEqual(["approve", "rewrite", "interested", "not_interested", "do_not_contact"]);
    expect(pmMoves({ status: "no_email", email: null, hasDrafts: false })).toEqual(["set_email", "interested", "not_interested", "do_not_contact"]);
    expect(pmMoves({ status: "do_not_contact", email: "a@b.com", hasDrafts: false })).toEqual([]);
    expect(pmMoves({ status: "replied", email: "a@b.com", hasDrafts: false })).toEqual(["interested", "not_interested", "do_not_contact"]);
  });

  it("moves a prospect anywhere but where it is, unless never to be contacted", () => {
    expect(prospectMoves("new", false)).toEqual(["queued", "contacted", "converted", "rejected"]);
    expect(prospectMoves("contacted", true)).toEqual([]);
  });

  it("only posts a held reply when Google is connected", () => {
    expect(reviewMoves("held", true)).toEqual(["post_reply", "skip"]);
    expect(reviewMoves("held", false)).toEqual(["skip"]);
    expect(reviewMoves("none", true)).toEqual(["draft", "skip"]);
    expect(reviewMoves("posted", true)).toEqual([]);
  });

  it("moves mailings and flyer runs to any other step", () => {
    expect(mailingMoves("planned")).toEqual(["printed", "mailed"]);
    expect(flyerRunMoves("open")).toEqual(["closed", "printed"]);
  });
});

describe("inputs", () => {
  it("reads a commission rate", () => {
    expect(parseRate("10")).toBe(10);
    expect(parseRate("12.5%")).toBe(12.5);
    expect(parseRate("")).toBeNull();
    expect(parseRate("101")).toBe("bad");
    expect(parseRate("ten")).toBe("bad");
  });

  it("reads a website page id", () => {
    expect(parsePageId("home")).toEqual({ kind: "home" });
    expect(parsePageId("area:bel-air")).toEqual({ kind: "area", slug: "bel-air" });
    expect(parsePageId("area:")).toBeNull();
    expect(parsePageId("blog")).toBeNull();
  });
});
