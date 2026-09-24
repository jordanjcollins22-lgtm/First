import { describe, expect, it } from "vitest";

import { ageNow, standingFor, stillFresh, whyNotTake, type BoardAnswer } from "./post-board";

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

  it("is taken while somebody else is writing, and open again after the hold", () => {
    expect(standingFor([answer({})], "me", now).pile).toBe("taken");
    const stale = answer({ updatedAt: "2026-09-24T15:00:00Z" });
    expect(standingFor([stale], "me", now).pile).toBe("open");
  });

  it("is answered for good once somebody posted", () => {
    const posted = answer({ status: "posted", updatedAt: "2026-09-20T12:00:00Z" });
    expect(standingFor([posted], "me", now)).toMatchObject({ pile: "answered", heldBy: { name: "Jace" } });
  });

  it("stays mine however many others answered", () => {
    const mine = answer({ id: "m", profileId: "me", name: "Jordan" });
    const theirs = answer({ status: "posted" });
    expect(standingFor([mine, theirs], "me", now)).toMatchObject({ pile: "mine", mine: { id: "m" } });
  });

  it("lets go of a post handed back", () => {
    expect(standingFor([answer({ status: "let_go" })], "me", now).pile).toBe("open");
    expect(standingFor([answer({ profileId: "me", status: "let_go" })], "me", now).pile).toBe("open");
  });
});

describe("whyNotTake", () => {
  const base = { profileId: "me", now, answeredToday: 0, dailyLimit: 6 };
  it("allows an open post", () => {
    expect(whyNotTake({ ...base, answers: [] })).toBeNull();
  });
  it("names who has it", () => {
    expect(whyNotTake({ ...base, answers: [answer({})] })).toMatch(/Jace is answering/);
    expect(whyNotTake({ ...base, answers: [answer({ status: "posted" })] })).toMatch(/Jace already answered/);
  });
  it("stops at the day's limit, but never stops you reopening your own", () => {
    expect(whyNotTake({ ...base, answers: [], answeredToday: 6 })).toMatch(/6 from your account today/);
    expect(whyNotTake({ ...base, answers: [answer({ profileId: "me" })], answeredToday: 6 })).toBeNull();
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
