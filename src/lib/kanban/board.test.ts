import { describe, expect, it } from "vitest";

import {
  DEFAULT_WIP_LIMITS,
  STAGES,
  countByColumn,
  limitedColumnFor,
  nextStage,
  parseWipLimit,
  positionAtBottom,
  positionAtTop,
  previousStage,
  wipViolation,
} from "./board";

describe("stage flow", () => {
  it("walks a card from Backlog to Validate > Done", () => {
    const path = ["backlog"] as (typeof STAGES)[number][];
    let s = nextStage("backlog");
    while (s) {
      path.push(s);
      s = nextStage(s);
    }
    expect(path).toEqual([
      "backlog",
      "breakdown",
      "breakdown_done",
      "answer",
      "answer_done",
      "validate",
      "validate_done",
    ]);
  });

  it("moves Track on to Answer > Done, and back to Answer", () => {
    expect(nextStage("answer_track")).toBe("answer_done");
    expect(previousStage("answer_track")).toBe("answer");
  });

  it("every stage except Backlog can step back", () => {
    for (const s of STAGES) {
      if (s === "backlog") expect(previousStage(s)).toBeNull();
      else expect(previousStage(s)).not.toBeNull();
    }
  });
});

describe("WIP limits", () => {
  it("counts Done and Track toward their column, not Backlog or the final Done", () => {
    expect(limitedColumnFor("breakdown_done")).toBe("breakdown");
    expect(limitedColumnFor("answer_track")).toBe("answer");
    expect(limitedColumnFor("backlog")).toBeNull();
    expect(limitedColumnFor("validate_done")).toBeNull();
    expect(
      countByColumn(["backlog", "breakdown", "breakdown_done", "answer_track", "validate_done"])
    ).toEqual({ breakdown: 2, answer: 1, validate: 0 });
  });

  it("blocks pulling into a full column", () => {
    const board = ["breakdown", "breakdown_done"] as const;
    expect(wipViolation("backlog", "breakdown", [...board], DEFAULT_WIP_LIMITS)).toMatch(
      /Breakdown is full \(2 of 2\)/
    );
  });

  it("allows moves inside a full column", () => {
    const board = ["breakdown", "breakdown_done"] as const;
    expect(wipViolation("breakdown", "breakdown_done", [...board], DEFAULT_WIP_LIMITS)).toBeNull();
    const answers = ["answer", "answer", "answer_done", "answer_done"] as const;
    expect(wipViolation("answer", "answer_track", [...answers], DEFAULT_WIP_LIMITS)).toBeNull();
  });

  it("never limits Backlog or the final Done", () => {
    expect(wipViolation("breakdown", "backlog", [], { breakdown: 1, answer: 1, validate: 1 })).toBeNull();
    expect(
      wipViolation("validate", "validate_done", ["validate"], { breakdown: 1, answer: 1, validate: 1 })
    ).toBeNull();
  });

  it("parses limits from a form", () => {
    expect(parseWipLimit("3")).toBe(3);
    expect(parseWipLimit("0")).toBeNull();
    expect(parseWipLimit("2.5")).toBeNull();
    expect(parseWipLimit("")).toBeNull();
  });
});

describe("positions", () => {
  it("puts cards at the top or bottom", () => {
    expect(positionAtBottom([])).toBe(0);
    expect(positionAtBottom([0, 3, 1])).toBe(4);
    expect(positionAtTop([0, 3, 1])).toBe(-1);
  });
});
