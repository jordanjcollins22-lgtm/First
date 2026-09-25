import { describe, expect, it } from "vitest";

import { ageNow, isPostLink, standingFor, stillFresh, whyNotTake, type BoardAnswer } from "./post-board";

const now = new Date("2026-09-24T18:00:00Z");

function answer(over: Partial<BoardAnswer>): BoardAnswer {
  return {
    id: "a",
    profileId: "p1",
    name: "Jace",
    status: "written",
    comment: null,
    code: null,
    clicks: 0,
    createdAt: "2026-09-24T17:30:00Z",
    updatedAt: "2026-09-24T17:30:00Z",
    postedAt: null,
    ...over,
  };
}

describe("standingFor", () => {
  it("is open when nobody has it", () => {
    expect(standingFor([], "me", now).pile).toBe("open");
  });

  it("stays open with one person on it, and is full with two", () => {
    expect(standingFor([answer({})], "me", now)).toMatchObject({ pile: "open", others: [{ name: "Jace" }] });
    const two = [answer({ status: "posted" }), answer({ id: "b", profileId: "p2", name: "Andrew" })];
    expect(standingFor(two, "me", now).pile).toBe("full");
  });

  it("frees a place once the hold runs out, but never once posted", () => {
    const stale = answer({ id: "b", profileId: "p2", name: "Andrew", updatedAt: "2026-09-24T15:00:00Z" });
    expect(standingFor([answer({}), stale], "me", now).pile).toBe("open");
    const oldPosts = [answer({ status: "posted", updatedAt: "2026-09-20T12:00:00Z" }), answer({ id: "b", profileId: "p2", status: "posted", updatedAt: "2026-09-20T12:00:00Z" })];
    expect(standingFor(oldPosts, "me", now).pile).toBe("full");
  });

  it("stays mine however many others answered", () => {
    const mine = answer({ id: "m", profileId: "me", name: "Jordan" });
    const theirs = [answer({ status: "posted" }), answer({ id: "b", profileId: "p2", status: "posted" })];
    expect(standingFor([mine, ...theirs], "me", now)).toMatchObject({ pile: "mine", mine: { id: "m" } });
  });

  it("lets go of a post handed back", () => {
    expect(standingFor([answer({ status: "let_go" })], "me", now).pile).toBe("open");
    expect(standingFor([answer({ profileId: "me", status: "let_go" })], "me", now).pile).toBe("open");
  });
});

describe("whyNotTake", () => {
  const base = { profileId: "me", now, answeredToday: 0, dailyLimit: 6 };
  const two = [answer({ status: "posted" }), answer({ id: "b", profileId: "p2", name: "Andrew" })];
  it("allows a post with a place left", () => {
    expect(whyNotTake({ ...base, answers: [] })).toBeNull();
    expect(whyNotTake({ ...base, answers: [answer({ status: "posted" })] })).toBeNull();
  });
  it("names who has a full one", () => {
    expect(whyNotTake({ ...base, answers: two })).toMatch(/Jace and Andrew already have this one/);
  });
  it("stops at the day's limit, but never stops you reopening your own", () => {
    expect(whyNotTake({ ...base, answers: [], answeredToday: 6 })).toMatch(/6 from your account today/);
    expect(whyNotTake({ ...base, answers: [answer({ profileId: "me" })], answeredToday: 6 })).toBeNull();
  });
  it("never turns the owner away", () => {
    expect(whyNotTake({ ...base, answers: two, override: true })).toBeNull();
    expect(whyNotTake({ ...base, answers: two, answeredToday: 20, override: true })).toBeNull();
  });
});

describe("age", () => {
  it("adds the days since it was read", () => {
    expect(ageNow(2, "2026-09-20T18:00:00Z", now)).toBe(6);
    expect(ageNow(null, "2026-09-24T10:00:00Z", now)).toBe(0);
    expect(stillFresh(0, "2026-09-01T00:00:00Z", now)).toBe(false);
    expect(stillFresh(1, "2026-09-22T00:00:00Z", now)).toBe(true);
  });
});

describe("isPostLink", () => {
  it("takes a link to the post itself", () => {
    expect(isPostLink("https://www.facebook.com/groups/harfordhappenings/posts/1234567890/")).toBe(true);
    expect(isPostLink("https://www.facebook.com/groups/123/permalink/456/")).toBe(true);
    expect(isPostLink("https://www.facebook.com/share/p/1AbCdEfGh/")).toBe(true);
    expect(isPostLink("https://www.facebook.com/permalink.php?story_fbid=123&id=456")).toBe(true);
    expect(isPostLink("https://m.facebook.com/HarfordLawnCare/posts/pfbid02abc")).toBe(true);
  });
  it("refuses no link, a search, a group's front page and somebody's profile", () => {
    expect(isPostLink("")).toBe(false);
    expect(isPostLink(null)).toBe(false);
    expect(isPostLink("https://www.facebook.com/search/posts?q=need%20a%20landscaper")).toBe(false);
    expect(isPostLink("https://www.facebook.com/groups/harfordhappenings/")).toBe(false);
    expect(isPostLink("https://www.facebook.com/profile.php?id=100000")).toBe(false);
    expect(isPostLink("https://evil.example.com/groups/1/posts/2")).toBe(false);
  });
});
