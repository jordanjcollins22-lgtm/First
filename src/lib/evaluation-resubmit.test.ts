import { describe, expect, it } from "vitest";

import {
  canSubmit,
  describeDiff,
  diffScope,
  regenDecision,
  submitLabel,
} from "./evaluation-resubmit";

function zone(zoneName: string, serviceLabel: string) {
  return { zoneName, serviceLabel };
}

describe("regenDecision", () => {
  it("just goes ahead when there is no proposal yet", () => {
    const d = regenDecision(null);
    expect(d.allowed).toBe(true);
    expect(d.confirm).toBeNull();
  });

  it("replaces a draft without asking", () => {
    const d = regenDecision({ status: "needs_approval", respondedAt: null });
    expect(d.allowed).toBe(true);
    expect(d.confirm).toBeNull();
    expect(d.note).toMatch(/replaced/);
  });

  it("asks before wiping an acceptance", () => {
    const d = regenDecision({ status: "accepted", respondedAt: "2026-08-01T00:00:00Z" });
    expect(d.allowed).toBe(false);
    expect(d.confirm).toMatch(/already accepted/);
  });

  it("does not ask about a sent one, but says what happens to the link", () => {
    // Dropping back to unapproved is the safe outcome; a client reading a
    // stale price is the unsafe one.
    const d = regenDecision({ status: "sent", respondedAt: null });
    expect(d.allowed).toBe(true);
    expect(d.confirm).toBeNull();
    expect(d.note).toMatch(/unapproved/);
  });

  it("does not ask about a declined one", () => {
    const d = regenDecision({ status: "declined", respondedAt: "2026-08-01T00:00:00Z" });
    expect(d.allowed).toBe(true);
    expect(d.confirm).toBeNull();
    expect(d.note).toMatch(/declined/);
  });
});

describe("diffScope", () => {
  it("finds a service swapped on the same zone", () => {
    const diff = diffScope([zone("Front lawn", "Lawn Care")], [zone("Front lawn", "Weed Removal")]);
    expect(diff.changed).toEqual([
      { zoneName: "Front lawn", before: "Lawn Care", after: "Weed Removal" },
    ]);
    expect(diff.identical).toBe(false);
  });

  it("says nothing changed when nothing did", () => {
    const same = [zone("Front lawn", "Lawn Care"), zone("Drive", "Weed Removal")];
    const diff = diffScope(same, [...same]);
    expect(diff.identical).toBe(true);
    expect(describeDiff(diff)).toEqual([]);
  });

  it("is not fooled by the zones being in a different order", () => {
    const before = [zone("A", "Lawn Care"), zone("B", "Mulch")];
    const after = [zone("B", "Mulch"), zone("A", "Lawn Care")];
    expect(diffScope(before, after).identical).toBe(true);
  });

  it("spots an added zone", () => {
    const diff = diffScope([zone("A", "Lawn Care")], [zone("A", "Lawn Care"), zone("B", "Mulch")]);
    expect(diff.added).toEqual([{ zoneName: "B", before: null, after: "Mulch" }]);
    expect(diff.changed).toEqual([]);
  });

  it("spots a removed zone", () => {
    const diff = diffScope([zone("A", "Lawn Care"), zone("B", "Mulch")], [zone("A", "Lawn Care")]);
    expect(diff.removed).toEqual([{ zoneName: "B", before: "Mulch", after: null }]);
  });

  it("reads a rename as one gone and one arrived", () => {
    // Which is honest: nothing distinguishes that from an actual swap.
    const diff = diffScope([zone("Front", "Lawn Care")], [zone("Front lawn", "Lawn Care")]);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toEqual([]);
  });

  it("copes with an empty side", () => {
    expect(diffScope([], [zone("A", "Mulch")]).added).toHaveLength(1);
    expect(diffScope([zone("A", "Mulch")], []).removed).toHaveLength(1);
    expect(diffScope([], []).identical).toBe(true);
  });
});

describe("describeDiff", () => {
  it("writes the swap the way somebody would say it", () => {
    const diff = diffScope([zone("Front lawn", "Lawn Care")], [zone("Front lawn", "Weed Removal")]);
    expect(describeDiff(diff)).toEqual(["Front lawn: Lawn Care → Weed Removal"]);
  });

  it("lists changes before additions before removals", () => {
    const before = [zone("A", "Lawn Care"), zone("C", "Mulch")];
    const after = [zone("A", "Weed Removal"), zone("B", "Edging")];
    const lines = describeDiff(diffScope(before, after));
    expect(lines[0]).toMatch(/^A: Lawn Care/);
    expect(lines[1]).toMatch(/^B: added/);
    expect(lines[2]).toMatch(/^C: removed/);
  });
});

describe("submitLabel", () => {
  it("offers to resend once the evaluation is in", () => {
    expect(submitLabel("completed", false)).toMatch(/Update & resend/);
  });

  it("is the plain submit before that", () => {
    expect(submitLabel("scheduled", false)).toBe("Submit Evaluation");
  });

  it("says what it is doing while it works", () => {
    expect(submitLabel("completed", true)).toBe("Submitting…");
  });
});

describe("canSubmit", () => {
  it("stays live after an evaluation has been submitted", () => {
    // The whole bug: this used to go false forever the moment the status
    // became completed, so a correction could never be sent.
    expect(canSubmit("job-1", false)).toBe(true);
  });

  it("is off while a submit is in flight", () => {
    expect(canSubmit("job-1", true)).toBe(false);
  });

  it("is off with nothing to submit against", () => {
    expect(canSubmit(null, false)).toBe(false);
    expect(canSubmit(undefined, false)).toBe(false);
  });
});
