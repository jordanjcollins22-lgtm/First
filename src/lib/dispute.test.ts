import { describe, expect, it } from "vitest";

import {
  DISPUTE_KINDS,
  NO_DISPUTE,
  disputeLine,
  hasDisputeHistory,
  historyLine,
  inDispute,
  isDisputeKind,
  kindLabel,
  mayContactAutomatically,
  type DisputeState,
} from "./dispute";

function open(over: Partial<DisputeState> = {}): DisputeState {
  return {
    openedAt: "2026-08-20T10:00:00Z",
    resolvedAt: null,
    kind: "legal",
    reason: "Solicitor's letter about the retaining wall.",
    ...over,
  };
}

describe("inDispute", () => {
  it("is nothing on the overwhelming majority of jobs", () => {
    expect(inDispute(NO_DISPUTE)).toBe(false);
  });

  it("is true once one is opened", () => {
    expect(inDispute(open())).toBe(true);
  });

  it("is false once it is resolved", () => {
    expect(inDispute(open({ resolvedAt: "2026-08-25T10:00:00Z" }))).toBe(false);
  });

  it("is true again when a second one opens after the first was resolved", () => {
    // A new dispute writes a new opened date over an old resolved one, so the
    // dates are compared rather than the order assumed.
    expect(
      inDispute({
        openedAt: "2026-09-01T10:00:00Z",
        resolvedAt: "2026-08-25T10:00:00Z",
        kind: "payment",
        reason: null,
      })
    ).toBe(true);
  });
});

describe("hasDisputeHistory", () => {
  it("remembers a resolved one, because the next quote should know", () => {
    expect(hasDisputeHistory(open({ resolvedAt: "2026-08-25T10:00:00Z" }))).toBe(true);
    expect(hasDisputeHistory(NO_DISPUTE)).toBe(false);
  });
});

describe("mayContactAutomatically", () => {
  it("stops the machine texting somebody who is suing us", () => {
    expect(mayContactAutomatically(open())).toBe(false);
  });

  it("lets everything through again once it is resolved", () => {
    expect(mayContactAutomatically(open({ resolvedAt: "2026-08-25T10:00:00Z" }))).toBe(true);
  });

  it("never gets in the way of an ordinary job", () => {
    expect(mayContactAutomatically(NO_DISPUTE)).toBe(true);
  });
});

describe("disputeLine", () => {
  it("says what is wrong without anybody opening the job", () => {
    expect(disputeLine(open())).toBe("Legal — Solicitor's letter about the retaining wall.");
  });

  it("still names the kind when nobody wrote a reason", () => {
    expect(disputeLine(open({ reason: null }))).toBe("Legal");
    expect(disputeLine(open({ reason: "   " }))).toBe("Legal");
  });

  it("says nothing about a job that is not in one", () => {
    expect(disputeLine(NO_DISPUTE)).toBeNull();
    expect(disputeLine(open({ resolvedAt: "2026-08-25T10:00:00Z" }))).toBeNull();
  });

  it("falls back rather than showing a raw value it does not know", () => {
    expect(disputeLine(open({ kind: "something_new", reason: null }))).toBe("Other");
  });
});

describe("historyLine", () => {
  it("says so afterwards, so the next quote knows how the last one ended", () => {
    expect(historyLine(open({ resolvedAt: "2026-08-25T10:00:00Z" }))).toBe(
      "Was in dispute (legal), resolved."
    );
  });

  it("says nothing while it is still live — the card is already saying it", () => {
    expect(historyLine(open())).toBeNull();
  });

  it("says nothing about a job that never had one", () => {
    expect(historyLine(NO_DISPUTE)).toBeNull();
  });
});

describe("the kinds", () => {
  it("covers the reasons work actually stops", () => {
    expect(DISPUTE_KINDS.map((k) => k.value)).toEqual(["legal", "payment", "quality", "other"]);
    expect(isDisputeKind("legal")).toBe(true);
    expect(isDisputeKind("nonsense")).toBe(false);
  });

  it("has a label for every one, and for one it has never seen", () => {
    for (const kind of DISPUTE_KINDS) expect(kindLabel(kind.value)).toBe(kind.label);
    expect(kindLabel(null)).toBe("Other");
  });
});
