import { describe, expect, it } from "vitest";

import {
  NO_SHOW_REASON,
  dollars,
  extendedExpiry,
  movedEnd,
  parseVisitTime,
  planStatusChange,
  proposalActionsFor,
  readAreaList,
  startsRebook,
  statusWords,
  suggestPhaseOne,
  visitTimeText,
} from "@/lib/entities/sales-rules";

describe("planStatusChange", () => {
  it("cancels through cancelJob", () => {
    expect(planStatusChange("quoted", "cancelled")).toEqual({ ok: true, via: "cancel" });
  });
  it("won't cancel finished work", () => {
    expect(planStatusChange("completed", "cancelled").ok).toBe(false);
  });
  it("reopens a cancelled job before setting it", () => {
    expect(planStatusChange("cancelled", "quoted")).toEqual({ ok: true, via: "reopen_then_set", status: "quoted" });
  });
  it("sets anything else directly", () => {
    expect(planStatusChange("estimating", "approved")).toEqual({ ok: true, via: "set", status: "approved" });
  });
  it("refuses the same status and unknown ones", () => {
    expect(planStatusChange("quoted", "quoted").ok).toBe(false);
    expect(planStatusChange("quoted", "nonsense").ok).toBe(false);
  });
});

describe("no-show reason", () => {
  it("is read as a no-show by the rebook sequence", () => {
    expect(startsRebook(NO_SHOW_REASON)).toBe(true);
  });
  it("an office reason is not", () => {
    expect(startsRebook("Duplicate booking")).toBe(false);
  });
});

describe("parseVisitTime", () => {
  it("reads a 24-hour time in New York", () => {
    expect(parseVisitTime("2026-10-20 14:30")?.toISOString()).toBe("2026-10-20T18:30:00.000Z");
  });
  it("reads am/pm", () => {
    expect(parseVisitTime("2026-12-01 2:30 pm")?.toISOString()).toBe("2026-12-01T19:30:00.000Z");
    expect(parseVisitTime("2026-12-01 12 am")?.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
  it("defaults to 9 AM with no time", () => {
    expect(parseVisitTime("2026-10-20")?.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
  it("rejects nonsense", () => {
    expect(parseVisitTime("tomorrow")).toBeNull();
    expect(parseVisitTime("2026-10-20 25:00")).toBeNull();
    expect(parseVisitTime("2026-13-01 10:00")).toBeNull();
    expect(parseVisitTime(undefined)).toBeNull();
  });
  it("round-trips with visitTimeText", () => {
    const iso = "2026-10-20T18:30:00.000Z";
    expect(visitTimeText(iso)).toBe("2026-10-20 14:30");
    expect(parseVisitTime(visitTimeText(iso))?.toISOString()).toBe(iso);
  });
});

describe("movedEnd", () => {
  it("keeps the visit's length", () => {
    expect(movedEnd("2026-10-20T14:00:00Z", "2026-10-20T15:30:00Z", new Date("2026-10-21T10:00:00Z"))).toBe("2026-10-21T11:30:00.000Z");
  });
  it("is null with no end", () => {
    expect(movedEnd("2026-10-20T14:00:00Z", null, new Date())).toBeNull();
  });
});

describe("extendedExpiry", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("counts from the old expiry when it is still ahead", () => {
    const next = extendedExpiry("2026-10-20T12:00:00Z", now, 7);
    expect(next.getTime()).toBeGreaterThan(new Date("2026-10-26T00:00:00Z").getTime());
  });
  it("counts from now when it has passed", () => {
    const next = extendedExpiry("2026-10-01T12:00:00Z", now, 7);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime()).toBeLessThan(new Date("2026-10-22T00:00:00Z").getTime());
  });
});

describe("proposalActionsFor", () => {
  it("a draft can be approved, priced or declined", () => {
    expect(proposalActionsFor({ status: "needs_approval", approvedAt: null, expired: false, officeDeclinedFrom: null })).toEqual(["approve", "set_price", "decline", "stop_messages"]);
  });
  it("a sent one can be resent, extended, accepted or declined", () => {
    expect(proposalActionsFor({ status: "sent", approvedAt: "x", expired: false, officeDeclinedFrom: null })).toEqual(["resend", "extend", "accept", "decline", "stop_messages"]);
  });
  it("an expired sent one can't be accepted", () => {
    expect(proposalActionsFor({ status: "sent", approvedAt: "x", expired: true, officeDeclinedFrom: null })).not.toContain("accept");
  });
  it("a declined one can be won back, and reopened when the clock closed it", () => {
    expect(proposalActionsFor({ status: "declined", approvedAt: "x", expired: true, officeDeclinedFrom: "sent" })).toEqual(["extend", "win_back", "stop_messages"]);
    expect(proposalActionsFor({ status: "declined", approvedAt: "x", expired: false, officeDeclinedFrom: null })).toEqual(["win_back", "stop_messages"]);
  });
  it("an accepted one only stops messages", () => {
    expect(proposalActionsFor({ status: "accepted", approvedAt: "x", expired: false, officeDeclinedFrom: null })).toEqual(["stop_messages"]);
  });
});

describe("readAreaList", () => {
  it("matches names without minding case, and says which didn't match", () => {
    expect(readAreaList("front beds, BACK LAWN\nmoon", ["Front beds", "Back lawn", "Side"])).toEqual({ keep: ["Front beds", "Back lawn"], unknown: ["moon"] });
  });
  it("ignores repeats and blanks", () => {
    expect(readAreaList("Side,, side", ["Side"])).toEqual({ keep: ["Side"], unknown: [] });
  });
});

describe("suggestPhaseOne", () => {
  it("leaves off the dearest area", () => {
    expect(suggestPhaseOne([{ name: "A", cents: 100 }, { name: "B", cents: 900 }, { name: "C", cents: null }])).toEqual(["A", "C"]);
  });
  it("suggests a lone area as is", () => {
    expect(suggestPhaseOne([{ name: "A", cents: 100 }])).toEqual(["A"]);
  });
});

describe("formatting", () => {
  it("dollars", () => {
    expect(dollars(1250.4)).toBe("$1,250");
    expect(dollars(null)).toBe("—");
  });
  it("statusWords", () => {
    expect(statusWords("needs_approval")).toBe("Needs approval");
    expect(statusWords(null)).toBe("—");
  });
});
