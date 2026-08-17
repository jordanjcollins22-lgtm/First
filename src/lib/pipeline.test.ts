import { describe, expect, it } from "vitest";

import { isOnPipeline, pipelinePosition, STAGE_STATUSES, type PipelineInput } from "@/lib/pipeline";

function job(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    status: "estimating",
    evaluationStatus: null,
    evaluationDate: null,
    projectStartDate: null,
    projectEndDate: null,
    proposalStatus: null,
    ...overrides,
  };
}

describe("pipelinePosition", () => {
  it("puts a booked evaluation in Evaluation", () => {
    const p = pipelinePosition(job({ evaluationDate: "2026-08-20T14:00:00Z", evaluationStatus: "scheduled" }));
    expect(p).toEqual({ stage: "evaluation", status: "Scheduled", actionable: true });
  });

  it("tracks the evaluator's progress through the visit", () => {
    expect(pipelinePosition(job({ evaluationDate: "x", evaluationStatus: "on_way" })).status).toBe("On the way");
    expect(pipelinePosition(job({ evaluationDate: "x", evaluationStatus: "arrived" })).status).toBe("Arrived");
  });

  it("moves to Sales once the evaluation is done", () => {
    const p = pipelinePosition(job({ evaluationDate: "x", evaluationStatus: "completed" }));
    expect(p.stage).toBe("sales");
    expect(p.status).toBe("Needs pricing");
  });

  it("marks a quote waiting on the client as not actionable", () => {
    const p = pipelinePosition(job({ status: "quoted", proposalStatus: "sent" }));
    expect(p).toEqual({ stage: "sales", status: "Sent", actionable: false });
  });

  it("flags a proposal that still needs our approval", () => {
    expect(pipelinePosition(job({ proposalStatus: "needs_approval" })).actionable).toBe(true);
  });

  it("moves an accepted proposal into Operations even before the status catches up", () => {
    const p = pipelinePosition(job({ status: "quoted", proposalStatus: "accepted" }));
    expect(p.stage).toBe("operations");
    expect(p.status).toBe("Won — not scheduled");
    expect(p.actionable).toBe(true);
  });

  it("stops flagging a won job once it has work days", () => {
    const p = pipelinePosition(job({ status: "approved", projectStartDate: "2026-08-24" }));
    expect(p.status).toBe("Scheduled");
    expect(p.actionable).toBe(false);
  });

  it("reads in progress and completed straight off the job", () => {
    expect(pipelinePosition(job({ status: "in_progress" })).status).toBe("In progress");
    expect(pipelinePosition(job({ status: "completed" })).status).toBe("Completed");
  });

  it("keeps a declined quote visible but not actionable", () => {
    const p = pipelinePosition(job({ proposalStatus: "declined" }));
    expect(p).toEqual({ stage: "sales", status: "Declined", actionable: false });
  });

  it("only ever returns a status its own stage declares", () => {
    const samples: PipelineInput[] = [
      job({ evaluationDate: "x", evaluationStatus: "arrived" }),
      job({ proposalStatus: "sent" }),
      job({ status: "in_progress" }),
      job({ status: "approved" }),
      job(),
    ];
    for (const sample of samples) {
      const p = pipelinePosition(sample);
      expect(STAGE_STATUSES[p.stage]).toContain(p.status);
    }
  });
});

describe("isOnPipeline", () => {
  it("drops cancelled jobs off the board", () => {
    expect(isOnPipeline(job({ status: "cancelled" }))).toBe(false);
    expect(isOnPipeline(job())).toBe(true);
  });
});
