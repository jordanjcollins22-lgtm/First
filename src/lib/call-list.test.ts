import { describe, expect, it } from "vitest";

import {
  buildCallList,
  callListHeadline,
  defaultCallbackOn,
  dueOn,
  recommend,
  scoreCall,
  soundsLikePrice,
  type CallItem,
} from "@/lib/call-list";

const TODAY = new Date(2026, 8, 12, 10, 0, 0);

function item(overrides: Partial<CallItem> = {}): CallItem {
  return {
    proposalId: "p1",
    jobId: "j1",
    customerId: "c1",
    customerName: "Deanna Molino",
    phone: "4435550142",
    address: "12 Main St, Bel Air",
    status: "sent",
    totalCents: 2_215_000,
    sentAt: "2026-09-11T14:00:00Z",
    respondedAt: null,
    responseNote: null,
    opens: 4,
    lastOpenAt: "2026-09-12T08:00:00Z",
    focus: null,
    objectionIds: [],
    services: ["Landscape bed"],
    accountManagerId: null,
    calls: [],
    ...overrides,
  };
}

describe("ranking", () => {
  it("puts a big, warm, unanswered proposal above a small cold one", () => {
    const big = item();
    const small = item({ proposalId: "p2", totalCents: 95_000, opens: 0, lastOpenAt: null, sentAt: "2026-08-20T14:00:00Z" });
    const list = buildCallList([small, big], TODAY);
    expect(list.now.map((r) => r.proposalId)).toEqual(["p1", "p2"]);
    expect(list.now[0].reason).toMatch(/opened it today/);
    expect(list.now[1].reason).toMatch(/never opened it/);
  });

  it("puts a fresh decline nobody has rung ahead of one already called about", () => {
    const fresh = item({ proposalId: "d1", status: "declined", respondedAt: "2026-09-11T10:00:00Z", totalCents: 345_000, responseNote: "It's a little more than we wanted to spend" });
    const rung = item({
      proposalId: "d2",
      status: "declined",
      respondedAt: "2026-09-09T10:00:00Z",
      totalCents: 345_000,
      calls: [{ at: "2026-09-10T10:00:00Z", outcome: "thinking", note: null, byName: "Jace", callbackOn: null }],
    });
    const list = buildCallList([rung, fresh], TODAY);
    expect(list.now.map((r) => r.proposalId)).toEqual(["d1", "d2"]);
    expect(scoreCall(fresh, TODAY).reason).toMatch(/it was the price/);
  });

  it("drops a decline that has gone cold, and one that went elsewhere", () => {
    const cold = item({ proposalId: "old", status: "declined", respondedAt: "2026-07-01T10:00:00Z" });
    const gone = item({ proposalId: "gone", calls: [{ at: "2026-09-11T10:00:00Z", outcome: "went_elsewhere", note: "Went with a neighbour's guy", byName: "Jace", callbackOn: null }] });
    const list = buildCallList([cold, gone, item()], TODAY);
    expect(list.now.map((r) => r.proposalId)).toEqual(["p1"]);
  });
});

describe("callbacks", () => {
  it("parks a no-answer for two days and a promised date until that date", () => {
    const rangOut = item({ calls: [{ at: "2026-09-11T10:00:00Z", outcome: "no_answer", note: null, byName: "Jace", callbackOn: null }] });
    expect(dueOn(rangOut)).toBe("2026-09-13");
    const promised = item({ proposalId: "p2", calls: [{ at: "2026-09-10T10:00:00Z", outcome: "call_back", note: null, byName: "Jace", callbackOn: "2026-09-20" }] });
    const list = buildCallList([rangOut, promised], TODAY);
    expect(list.now).toHaveLength(0);
    expect(list.later.map((r) => [r.proposalId, r.dueOn])).toEqual([
      ["p1", "2026-09-13"],
      ["p2", "2026-09-20"],
    ]);
    expect(callListHeadline(list)).toBe("Nothing due today. 2 to ring later, $44,300 on the table.");
  });

  it("brings a callback back on its day", () => {
    const due = item({ calls: [{ at: "2026-09-01T10:00:00Z", outcome: "next_season", note: null, byName: "Jace", callbackOn: "2026-09-12" }] });
    const list = buildCallList([due], TODAY);
    expect(list.now).toHaveLength(1);
    expect(list.now[0].recommendations[0].title).toMatch(/asked for a call on 2026-09-12/);
  });

  it("fills in a sensible date when none was picked", () => {
    expect(defaultCallbackOn("no_answer", TODAY)).toBe("2026-09-14");
    expect(defaultCallbackOn("next_season", TODAY)).toBe("2026-11-11");
    expect(defaultCallbackOn("said_yes", TODAY)).toBeNull();
  });
});

describe("recommendations", () => {
  it("offers a trim and a plan when the note says it was the price", () => {
    const recs = recommend(item({ status: "declined", responseNote: "Thank you, it's a little more than we budgeted" }));
    expect(recs[0].title).toMatch(/trim/i);
    expect(recs[0].action?.href).toBe("/jobs/j1?view=scope");
    expect(recs[1].title).toMatch(/spread/i);
    expect(soundsLikePrice("a little more than we budgeted")).toBe(true);
  });

  it("answers the questions they tapped, in the page's own words", () => {
    const recs = recommend(item({ objectionIds: ["price_high", "timing"] }));
    expect(recs.some((r) => r.title.includes("How did you come up with this price?"))).toBe(true);
    expect(recs.length).toBeLessThanOrEqual(3);
  });

  it("chases a proposal nobody has opened with the link", () => {
    const recs = recommend(item({ opens: 0, lastOpenAt: null }));
    expect(recs[0].title).toBe("They have not opened it");
    expect(recs[0].action?.href).toBe("/jobs/j1?view=messages");
  });

  it("always has something to say", () => {
    const recs = recommend(item({ opens: 1 }));
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].say).toMatch(/Hi Deanna/);
  });
});
