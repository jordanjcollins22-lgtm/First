import { describe, expect, it } from "vitest";

import {
  STAGES,
  TIERS,
  reopenBlocker,
  signOffBlocker,
  statusOf,
  summarize,
  type StageProgress,
} from "@/lib/career/stages";

function done(stage: number, count = 0): StageProgress {
  return { stage, count, note: null, completed_at: "2026-11-01T00:00:00Z", completed_by: "x" };
}
function open(stage: number, count = 0): StageProgress {
  return { stage, count, note: null, completed_at: null, completed_by: null };
}

describe("the ladder", () => {
  it("has 21 stages numbered in order across three tiers of seven", () => {
    expect(STAGES.map((s) => s.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    for (const tier of TIERS) {
      expect(STAGES.filter((s) => s.tier === tier.key).map((s) => s.number)).toEqual(
        Array.from({ length: tier.last - tier.first + 1 }, (_, i) => tier.first + i)
      );
    }
  });
});

describe("summarize", () => {
  it("starts everybody on Stage 1", () => {
    const s = summarize([]);
    expect(s.completed).toBe(0);
    expect(s.current?.number).toBe(1);
    expect(s.tier.key).toBe("technician");
  });

  it("counts only an unbroken run from Stage 1", () => {
    const s = summarize([done(1), done(2), done(4)]);
    expect(s.completed).toBe(2);
    expect(s.current?.number).toBe(3);
    expect(statusOf(4, s)).toBe("locked");
  });

  it("moves into the General Manager tier after Stage 7", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7].map((n) => done(n)));
    expect(s.current?.number).toBe(8);
    expect(s.tier.key).toBe("general_manager");
  });

  it("finishes at Owner with nothing next", () => {
    const s = summarize(STAGES.map((st) => done(st.number)));
    expect(s.completed).toBe(21);
    expect(s.current).toBeNull();
    expect(s.tier.key).toBe("owner");
  });

  it("carries the count toward the current stage", () => {
    expect(summarize([done(1), done(2), open(3, 4)]).currentCount).toBe(4);
  });
});

describe("signing off", () => {
  it("only allows the current stage", () => {
    expect(signOffBlocker(1, [])).toBeNull();
    expect(signOffBlocker(2, [])).toBe("Stage 1 comes first.");
    expect(signOffBlocker(1, [done(1)])).toBe("That stage is already signed off.");
  });

  it("waits for the stage's number", () => {
    expect(signOffBlocker(3, [done(1), done(2), open(3, 4)])).toMatch(/Needs 5 reviews/);
    expect(signOffBlocker(3, [done(1), done(2), open(3, 5)])).toBeNull();
  });

  it("only reopens the latest sign-off", () => {
    const progress = [done(1), done(2)];
    expect(reopenBlocker(2, progress)).toBeNull();
    expect(reopenBlocker(1, progress)).toBe("Reopen Stage 2 first.");
    expect(reopenBlocker(3, progress)).toBe("That stage isn't signed off.");
  });
});
