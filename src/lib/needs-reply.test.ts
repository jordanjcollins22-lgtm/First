import { describe, expect, it } from "vitest";

import {
  PROPOSAL_REFERENCE,
  canMarkRead,
  countNeedsReply,
  filterNeedsReply,
  needsReply,
  referenceLine,
  zoneReference,
  type ReplyState,
} from "./needs-reply";

function state(overrides: Partial<ReplyState> = {}): ReplyState {
  return {
    lastAuthorType: "client",
    lastMessageAt: "2026-08-29T12:00:00Z",
    readThrough: null,
    ...overrides,
  };
}

describe("needsReply", () => {
  it("is waiting on us when the client spoke last and nobody marked it read", () => {
    expect(needsReply(state())).toBe(true);
  });

  it("is not waiting when we spoke last", () => {
    expect(needsReply(state({ lastAuthorType: "team" }))).toBe(false);
  });

  it("clears once somebody marks it read", () => {
    expect(needsReply(state({ readThrough: "2026-08-29T12:00:01Z" }))).toBe(false);
  });

  it("comes back when the client writes again after a read mark", () => {
    // The whole point of storing a moment rather than a flag.
    expect(
      needsReply(state({ readThrough: "2026-08-29T12:00:00Z", lastMessageAt: "2026-08-30T09:00:00Z" }))
    ).toBe(true);
  });

  it("stays clear for a read mark on the same instant as the message", () => {
    expect(needsReply(state({ readThrough: "2026-08-29T12:00:00Z" }))).toBe(false);
  });
});

describe("filterNeedsReply", () => {
  it("keeps only the ones waiting on us, rather than sorting them to the top", () => {
    const items = [
      state(),
      state({ lastAuthorType: "team" }),
      state({ readThrough: "2026-08-30T00:00:00Z" }),
    ];
    expect(filterNeedsReply(items)).toHaveLength(1);
    expect(countNeedsReply(items)).toBe(1);
  });

  it("is empty when the inbox is clear", () => {
    expect(filterNeedsReply([state({ lastAuthorType: "team" })])).toEqual([]);
  });
});

describe("canMarkRead", () => {
  it("is offered only where it would change something", () => {
    expect(canMarkRead(state())).toBe(true);
    expect(canMarkRead(state({ lastAuthorType: "team" }))).toBe(false);
    expect(canMarkRead(state({ readThrough: "2026-08-30T00:00:00Z" }))).toBe(false);
  });
});

describe("referenceLine", () => {
  it("says what the message is about", () => {
    expect(referenceLine("Back bed (Mulch)")).toBe("Re: Back bed (Mulch)");
  });

  it("says nothing when there is nothing to reference", () => {
    expect(referenceLine(null)).toBeNull();
    expect(referenceLine("")).toBeNull();
    expect(referenceLine("   ")).toBeNull();
  });
});

describe("zoneReference", () => {
  it("names the area and the service on it", () => {
    expect(zoneReference("Back bed", "Mulch Install")).toBe("Back bed (Mulch Install)");
  });

  it("drops the brackets when there is no service", () => {
    expect(zoneReference("Back bed", null)).toBe("Back bed");
  });

  it("falls back rather than producing an empty label", () => {
    expect(zoneReference("", "Mulch")).toBe("Mulch");
    expect(zoneReference("", "")).toBe("Proposal");
  });

  it("has a label for the proposal as a whole", () => {
    expect(referenceLine(PROPOSAL_REFERENCE)).toBe("Re: Their proposal");
  });
});
