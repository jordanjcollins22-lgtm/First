import { describe, expect, it } from "vitest";

import { evaluationStage, evaluationStepState, type EvaluationInput } from "./evaluations-today";

const base: EvaluationInput = {
  dueAt: "2026-09-29T15:00:00Z", // 11:00 am in Maryland
  preEval: true,
  onWayAt: null,
  arrivedAt: null,
  submittedAt: null,
  pricedAt: null,
  sentAt: null,
  areasReviewed: 0,
  areasTotal: 5,
};
const before = new Date("2026-09-29T14:00:00Z");
const after = new Date("2026-09-29T15:20:00Z");

describe("where an evaluation out today has got to", () => {
  it("waits to set off, then is on the way, then walks it", () => {
    const waiting = evaluationStage(base, before);
    expect([waiting.step, waiting.moving, waiting.now]).toEqual([1, false, "Not on the way yet"]);
    expect(evaluationStepState(1, waiting, true)).toBe("todo");
    expect(evaluationStepState(0, waiting, true)).toBe("done");

    const going = evaluationStage({ ...base, onWayAt: "2026-09-29T14:40:00Z" }, before);
    expect([going.step, going.moving]).toEqual([1, true]);
    expect(evaluationStepState(1, going, true)).toBe("now");

    const there = evaluationStage({ ...base, onWayAt: "x", arrivedAt: "2026-09-29T14:58:00Z" }, after);
    expect(there.step).toBe(3);
    expect(evaluationStepState(2, there, true)).toBe("done");
    expect(evaluationStepState(3, there, true)).toBe("now");
    expect(there.late).toBe(false);
  });

  it("puts it on the account manager once it is submitted, then priced, then done when sent", () => {
    const submitted = evaluationStage({ ...base, arrivedAt: "x", submittedAt: "2026-09-29T16:00:00Z" }, after);
    expect([submitted.step, submitted.yourMove]).toEqual([5, "price"]);
    expect(evaluationStepState(4, submitted, true)).toBe("done");
    expect(evaluationStepState(5, submitted, true)).toBe("now");

    const priced = evaluationStage({ ...base, submittedAt: "x", pricedAt: "y" }, after);
    expect(priced.yourMove).toBe("send");

    const sent = evaluationStage({ ...base, submittedAt: "x", pricedAt: "y", sentAt: "z" }, after);
    expect(sent.yourMove).toBeNull();
    expect(evaluationStepState(6, sent, true)).toBe("done");
  });

  it("says when the evaluator is late, and how late in words", () => {
    expect(evaluationStage(base, after).issues).toContain("Late: due at 11:00 am and not on the way");
    expect(evaluationStage({ ...base, onWayAt: "x" }, after).issues).toContain("Running late: due at 11:00 am, still on the way");
    expect(evaluationStage({ ...base, arrivedAt: "x" }, after).late).toBe(false);
  });

  it("shows a missing pre-eval, until the visit is submitted", () => {
    const none = evaluationStage({ ...base, preEval: false }, before);
    expect(evaluationStepState(0, none, false)).toBe("missing");
    expect(none.issues[0]).toMatch(/No pre-eval/);
    expect(evaluationStage({ ...base, preEval: false, submittedAt: "x" }, after).issues).toEqual([]);
  });
});
