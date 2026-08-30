import { describe, expect, it } from "vitest";

import {
  derivedPosition,
  isOnPipeline,
  movableTo,
  overrideIsStale,
  overrideNote,
  pipelinePosition,
  STAGES,
  STAGE_STATUSES,
  type PipelineInput,
} from "@/lib/pipeline";

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

describe("needs sign-off", () => {
  const TODAY = new Date("2026-09-10T12:00:00Z");

  it("flags work whose window has passed and nobody closed", () => {
    // The case that actually goes missing: crew finished, drove away, and
    // closing the job was never anybody's next task.
    const p = pipelinePosition(
      job({ status: "in_progress", projectStartDate: "2026-09-01", projectEndDate: "2026-09-05" }),
      TODAY
    );
    expect(p).toEqual({ stage: "operations", status: "Needs sign-off", actionable: true });
  });

  it("leaves work still inside its window alone", () => {
    const p = pipelinePosition(
      job({ status: "in_progress", projectStartDate: "2026-09-08", projectEndDate: "2026-09-12" }),
      TODAY
    );
    expect(p.status).toBe("In progress");
  });

  it("does not flag the last day itself", () => {
    // A crew finishing today has not overrun anything.
    const p = pipelinePosition(
      job({ status: "in_progress", projectStartDate: "2026-09-09", projectEndDate: "2026-09-10" }),
      TODAY
    );
    expect(p.status).toBe("In progress");
  });

  it("flags approved work that came and went", () => {
    const p = pipelinePosition(
      job({ status: "approved", projectStartDate: "2026-09-01", projectEndDate: "2026-09-03" }),
      TODAY
    );
    expect(p.status).toBe("Needs sign-off");
  });

  it("leaves approved work still ahead as Scheduled", () => {
    const p = pipelinePosition(
      job({ status: "approved", projectStartDate: "2026-09-20", projectEndDate: "2026-09-22" }),
      TODAY
    );
    expect(p.status).toBe("Scheduled");
  });

  it("never flags a job already signed off", () => {
    const p = pipelinePosition(
      job({ status: "completed", projectStartDate: "2026-09-01", projectEndDate: "2026-09-03" }),
      TODAY
    );
    expect(p.status).toBe("Completed");
  });

  it("leaves unscheduled won work where it was", () => {
    expect(pipelinePosition(job({ status: "approved" }), TODAY).status).toBe("Won — not scheduled");
  });

  it("is a status the board knows how to show", () => {
    expect(STAGE_STATUSES.operations).toContain("Needs sign-off");
  });
});

describe("moving a job by hand", () => {
  const base: PipelineInput = {
    status: "estimating",
    evaluationStatus: null,
    evaluationDate: null,
    projectStartDate: null,
    projectEndDate: null,
    proposalStatus: "sent",
  };
  const today = new Date("2026-08-29T12:00:00Z");

  it("puts the job where somebody put it", () => {
    // They said yes on the phone; the proposal still says sent.
    const position = pipelinePosition(
      {
        ...base,
        override: { stage: "operations", status: "Won — not scheduled", from: "Sent" },
      },
      today
    );
    expect(position.stage).toBe("operations");
    expect(position.status).toBe("Won — not scheduled");
    expect(position.overridden).toBe(true);
    expect(overrideNote(position)).toMatch(/by hand/i);
  });

  it("gives the board back the moment the paperwork catches up", () => {
    // The same override, but the proposal has since been accepted. The
    // situation it was made against is gone, so the facts win again.
    const input: PipelineInput = {
      ...base,
      proposalStatus: "accepted",
      override: { stage: "operations", status: "Won — not scheduled", from: "Sent" },
    };
    const position = pipelinePosition(input, today);
    expect(position.overridden).toBeFalsy();
    expect(overrideIsStale(input, today)).toBe(true);
  });

  it("is not stale while nothing underneath has moved", () => {
    expect(
      overrideIsStale(
        { ...base, override: { stage: "operations", status: "Scheduled", from: "Sent" } },
        today
      )
    ).toBe(false);
  });

  it("ignores a placement naming somewhere that no longer exists", () => {
    // A status renamed in a later version must not strand a job nowhere.
    const position = pipelinePosition(
      { ...base, override: { stage: "operations", status: "Gone Fishing", from: "Sent" } },
      today
    );
    expect(position.status).toBe("Sent");
  });

  it("treats a moved job as somebody's to act on", () => {
    // Sent is deliberately not actionable — it is waiting on the client. A
    // job somebody dragged somewhere is waiting on them.
    expect(pipelinePosition(base, today).actionable).toBe(false);
    expect(
      pipelinePosition(
        { ...base, override: { stage: "sales", status: "Needs approval", from: "Sent" } },
        today
      ).actionable
    ).toBe(true);
  });

  it("changes nothing at all when nobody has moved it", () => {
    expect(pipelinePosition(base, today)).toEqual(derivedPosition(base, today));
  });

  it("offers every place on the board to move to", () => {
    const places = movableTo();
    expect(places).toHaveLength(
      STAGES.reduce((sum, stage) => sum + STAGE_STATUSES[stage.key].length, 0)
    );
    expect(places[0].label).toBe("Evaluation — Scheduled");
    expect(places.some((p) => p.label === "Operations — Completed")).toBe(true);
  });
});

describe("a job in dispute", () => {
  const today = new Date("2026-08-29T12:00:00Z");
  const sold: PipelineInput = {
    status: "approved",
    evaluationStatus: "completed",
    evaluationDate: "2026-08-01",
    projectStartDate: "2026-09-10",
    projectEndDate: null,
    proposalStatus: "accepted",
  };
  const dispute = {
    openedAt: "2026-08-20T10:00:00Z",
    resolvedAt: null,
    kind: "legal",
    reason: "Solicitor's letter.",
  };

  it("comes off the work columns entirely", () => {
    // It read as "Operations — Scheduled" before, which is a job to get on
    // with, which is the one thing nobody should do with it.
    expect(pipelinePosition(sold, today).stage).toBe("operations");
    expect(pipelinePosition({ ...sold, dispute }, today).stage).toBe("disputes");
  });

  it("says what kind of trouble it is", () => {
    expect(pipelinePosition({ ...sold, dispute }, today).status).toBe("Legal");
  });

  it("is not counted as work waiting to be picked up", () => {
    expect(pipelinePosition({ ...sold, dispute }, today).actionable).toBe(false);
  });

  it("beats a hand placement, which was made before the letter arrived", () => {
    const moved: PipelineInput = {
      ...sold,
      dispute,
      override: { stage: "operations", status: "In progress", from: "Scheduled" },
    };
    expect(pipelinePosition(moved, today).stage).toBe("disputes");
  });

  it("goes back to being read off the job once it is resolved", () => {
    const resolved = { ...dispute, resolvedAt: "2026-08-28T10:00:00Z" };
    expect(pipelinePosition({ ...sold, dispute: resolved }, today)).toEqual(
      pipelinePosition(sold, today)
    );
  });

  it("stays on the board — it is a job that needs somebody, not an absence", () => {
    // Cancelled comes off the board. A dispute must not, or it disappears.
    expect(isOnPipeline({ ...sold, dispute })).toBe(true);
  });

  it("offers the four kinds as places to move a job to", () => {
    const places = movableTo().filter((p) => p.stage === "disputes");
    expect(places.map((p) => p.status)).toEqual(["Legal", "Payment", "Quality", "Other"]);
  });

  it("changes nothing for the jobs that are not in one", () => {
    expect(pipelinePosition({ ...sold, dispute: null }, today)).toEqual(
      pipelinePosition(sold, today)
    );
  });
});
