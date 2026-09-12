import { describe, expect, it } from "vitest";

import type { Stop } from "@/lib/crew-day";
import {
  canRequestEarlyStart,
  describeRequest,
  isStillOpen,
  nextUp,
  openRequests,
  remainingToday,
  type EarlyStartRequest,
  type UpcomingVisit,
} from "./early-start";

function stop(jobId: string): Stop {
  return {
    jobId,
    sessionId: `s-${jobId}`,
    address: "1 Elm St",
    customerName: "A Client",
    lat: null,
    lng: null,
    purpose: null,
  };
}

function visit(over: Partial<UpcomingVisit> & { sessionId: string; startsOn: string }): UpcomingVisit {
  return {
    jobId: `j-${over.sessionId}`,
    address: "2 Oak Ave",
    customerName: "Next Client",
    purpose: null,
    ...over,
  };
}

function request(over: Partial<EarlyStartRequest> & { sessionId: string }): EarlyStartRequest {
  return {
    id: `r-${over.sessionId}`,
    status: "pending",
    requestedFor: "2026-08-27",
    declineReason: null,
    ...over,
  };
}

const TODAY = "2026-08-27";

describe("remainingToday", () => {
  it("counts the stops not yet finished", () => {
    expect(remainingToday([stop("a"), stop("b")], ["a"])).toBe(1);
  });

  it("is zero when the day is done", () => {
    expect(remainingToday([stop("a")], ["a"])).toBe(0);
  });

  it("is zero when there was nothing booked", () => {
    expect(remainingToday([], [])).toBe(0);
  });
});

describe("nextUp", () => {
  it("offers nothing while today still has work in it", () => {
    const result = nextUp({
      today: TODAY,
      stops: [stop("a"), stop("b")],
      finishedJobIds: ["a"],
      upcoming: [visit({ sessionId: "s1", startsOn: "2026-08-29" })],
    });
    expect(result).toBeNull();
  });

  it("offers the next job once today is finished", () => {
    const result = nextUp({
      today: TODAY,
      stops: [stop("a")],
      finishedJobIds: ["a"],
      upcoming: [visit({ sessionId: "s1", startsOn: "2026-08-29" })],
    });
    expect(result?.sessionId).toBe("s1");
  });

  it("takes the soonest, never further down the list", () => {
    const result = nextUp({
      today: TODAY,
      stops: [],
      finishedJobIds: [],
      upcoming: [
        visit({ sessionId: "later", startsOn: "2026-09-10" }),
        visit({ sessionId: "sooner", startsOn: "2026-08-28" }),
      ],
    });
    expect(result?.sessionId).toBe("sooner");
  });

  it("ignores anything booked for today or earlier", () => {
    const result = nextUp({
      today: TODAY,
      stops: [],
      finishedJobIds: [],
      upcoming: [
        visit({ sessionId: "today", startsOn: TODAY }),
        visit({ sessionId: "past", startsOn: "2026-08-01" }),
      ],
    });
    expect(result).toBeNull();
  });

  it("is stable when two visits start the same day", () => {
    const upcoming = [
      visit({ sessionId: "b", startsOn: "2026-08-29" }),
      visit({ sessionId: "a", startsOn: "2026-08-29" }),
    ];
    const once = nextUp({ today: TODAY, stops: [], finishedJobIds: [], upcoming });
    const twice = nextUp({ today: TODAY, stops: [], finishedJobIds: [], upcoming: [...upcoming].reverse() });
    expect(once?.sessionId).toBe(twice?.sessionId);
  });
});

describe("canRequestEarlyStart", () => {
  const next = visit({ sessionId: "s1", startsOn: "2026-08-29" });

  it("allows it when the day is done and nothing is pending", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: null,
      stops: [stop("a")],
      finishedJobIds: ["a"],
    });
    expect(verdict.ok).toBe(true);
  });

  it("names the last stop rather than greying out silently", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: null,
      stops: [stop("a")],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/last stop/);
  });

  it("counts the stops when several are left", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: null,
      stops: [stop("a"), stop("b"), stop("c")],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/3 remaining/);
  });

  it("says so when there is nothing else booked", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: null,
      existing: null,
      stops: [],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Nothing else/);
  });

  it("refuses a second ask while one is pending", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: request({ sessionId: "s1", status: "pending" }),
      stops: [],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/waiting on the account manager/i);
  });

  it("refuses once it has been approved", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: request({ sessionId: "s1", status: "approved" }),
      stops: [],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Approved/);
  });

  it("lets them ask again after a decline — the day has moved on", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: request({ sessionId: "s1", status: "declined", declineReason: "Client is away" }),
      stops: [],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(true);
  });

  it("ignores a pending request for a different visit", () => {
    const verdict = canRequestEarlyStart({
      today: TODAY,
      visit: next,
      existing: request({ sessionId: "somewhere-else", status: "pending" }),
      stops: [],
      finishedJobIds: [],
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("describeRequest", () => {
  it("says nothing when nothing has been asked", () => {
    expect(describeRequest(null)).toBeNull();
  });

  it("gives the decline reason back to the crew", () => {
    const text = describeRequest(
      request({ sessionId: "s1", status: "declined", declineReason: "Client is away" })
    );
    expect(text).toMatch(/Client is away/);
  });

  it("copes with a decline nobody explained", () => {
    expect(describeRequest(request({ sessionId: "s1", status: "declined" }))).toBe("Not this time.");
  });
});

describe("openRequests", () => {
  it("keeps only what still needs an answer", () => {
    const rows = [
      request({ sessionId: "a", requestedFor: "2026-08-28" }),
      request({ sessionId: "b", status: "approved", requestedFor: "2026-08-28" }),
      request({ sessionId: "c", requestedFor: "2026-08-01" }),
    ];
    expect(openRequests(rows, TODAY).map((r) => r.sessionId)).toEqual(["a"]);
  });

  it("puts the soonest first", () => {
    const rows = [
      request({ sessionId: "later", requestedFor: "2026-09-05" }),
      request({ sessionId: "sooner", requestedFor: "2026-08-28" }),
    ];
    expect(openRequests(rows, TODAY).map((r) => r.sessionId)).toEqual(["sooner", "later"]);
  });

  it("drops a request for a day that has already gone", () => {
    const stale = request({ sessionId: "a", requestedFor: "2026-08-20" });
    expect(isStillOpen(stale, TODAY)).toBe(false);
    expect(openRequests([stale], TODAY)).toEqual([]);
  });

  it("keeps one asked for today", () => {
    expect(isStillOpen(request({ sessionId: "a", requestedFor: TODAY }), TODAY)).toBe(true);
  });
});
