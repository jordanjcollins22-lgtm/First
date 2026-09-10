import { describe, expect, it } from "vitest";

import {
  byOwner,
  daysWaiting,
  inState,
  stateCounts,
  stateOf,
  type BoardEvaluation,
} from "@/lib/evaluation-board";

const NOW = "2026-09-10T12:00:00Z";

function evaluation(over: Partial<BoardEvaluation> = {}): BoardEvaluation {
  return {
    jobId: "j1",
    jobNumber: 101,
    customerName: "Dana",
    address: "1 Elm St",
    at: "2026-09-01T14:00:00Z",
    evaluationStatus: "scheduled",
    jobStatus: "estimating",
    assignedToId: "p1",
    assignedToName: "Jace",
    hasProposal: false,
    ...over,
  };
}

describe("where an evaluation sits", () => {
  it("is coming up when the date is still ahead", () => {
    expect(stateOf(evaluation({ at: "2026-09-20T14:00:00Z" }), NOW)).toBe("upcoming");
  });

  it("is owed once the date has passed and nothing was written", () => {
    expect(stateOf(evaluation({ at: "2026-09-01T14:00:00Z" }), NOW)).toBe("needs-submitting");
  });

  it("is owed the moment somebody sets off, whatever the date says", () => {
    // On the way at nine for a two o'clock is still an evaluation in progress.
    expect(stateOf(evaluation({ at: "2026-09-20T14:00:00Z", evaluationStatus: "on_way" }), NOW)).toBe(
      "needs-submitting"
    );
  });

  it("is owed when it is marked complete but no proposal ever went out", () => {
    // The case this whole list exists to catch. The flag says somebody pressed
    // a button; the proposal is the thing the client actually receives.
    expect(
      stateOf(evaluation({ evaluationStatus: "completed", hasProposal: false }), NOW)
    ).toBe("needs-submitting");
  });

  it("is submitted once a proposal exists", () => {
    expect(
      stateOf(evaluation({ evaluationStatus: "completed", hasProposal: true }), NOW)
    ).toBe("submitted");
  });

  it("leaves the owed pile once the job has moved past estimating", () => {
    expect(stateOf(evaluation({ jobStatus: "quoted" }), NOW)).toBe("submitted");
  });

  it("is cancelled when either the visit or the job was called off", () => {
    expect(stateOf(evaluation({ evaluationStatus: "cancelled" }), NOW)).toBe("cancelled");
    expect(stateOf(evaluation({ jobStatus: "cancelled" }), NOW)).toBe("cancelled");
  });

  it("treats a booking with no date as still coming up, not as owed", () => {
    // It is somebody's to schedule, not somebody's to write up, and putting it
    // in the owed pile would bury the ones that genuinely are.
    expect(stateOf(evaluation({ at: null }), NOW)).toBe("upcoming");
  });
});

describe("how long it has been owed", () => {
  it("counts the days since the appointment", () => {
    expect(daysWaiting(evaluation({ at: "2026-09-01T12:00:00Z" }), NOW)).toBe(9);
  });

  it("has nothing to say about one that is not owed", () => {
    expect(daysWaiting(evaluation({ at: "2026-09-20T12:00:00Z" }), NOW)).toBeNull();
  });

  it("has nothing to say about an owed one with no date", () => {
    expect(
      daysWaiting(evaluation({ at: null, evaluationStatus: "completed" }), NOW)
    ).toBeNull();
  });
});

describe("the order they are worked in", () => {
  it("puts the longest-waiting owed one first", () => {
    // The one waiting longest is both the likeliest to be forgotten and the
    // least likely to still close.
    const rows = inState(
      [
        evaluation({ jobId: "recent", at: "2026-09-09T12:00:00Z" }),
        evaluation({ jobId: "old", at: "2026-08-02T12:00:00Z" }),
      ],
      "needs-submitting",
      NOW
    );
    expect(rows.map((r) => r.jobId)).toEqual(["old", "recent"]);
  });

  it("puts an owed one with no date last, since there is no clock on it", () => {
    const rows = inState(
      [
        evaluation({ jobId: "undated", at: null, evaluationStatus: "completed" }),
        evaluation({ jobId: "dated", at: "2026-09-01T12:00:00Z" }),
      ],
      "needs-submitting",
      NOW
    );
    expect(rows.map((r) => r.jobId)).toEqual(["dated", "undated"]);
  });

  it("puts the soonest first among the ones coming up", () => {
    const rows = inState(
      [
        evaluation({ jobId: "later", at: "2026-09-25T12:00:00Z" }),
        evaluation({ jobId: "sooner", at: "2026-09-12T12:00:00Z" }),
      ],
      "upcoming",
      NOW
    );
    expect(rows.map((r) => r.jobId)).toEqual(["sooner", "later"]);
  });

  it("puts the most recent first among the ones already done", () => {
    const rows = inState(
      [
        evaluation({ jobId: "older", at: "2026-07-01T12:00:00Z", hasProposal: true }),
        evaluation({ jobId: "newer", at: "2026-08-01T12:00:00Z", hasProposal: true }),
      ],
      "submitted",
      NOW
    );
    expect(rows.map((r) => r.jobId)).toEqual(["newer", "older"]);
  });
});

describe("counts", () => {
  it("puts every evaluation in exactly one pile", () => {
    const rows = [
      evaluation({ jobId: "a", at: "2026-09-20T12:00:00Z" }),
      evaluation({ jobId: "b", at: "2026-09-01T12:00:00Z" }),
      evaluation({ jobId: "c", hasProposal: true }),
      evaluation({ jobId: "d", jobStatus: "cancelled" }),
    ];
    const counts = stateCounts(rows, NOW);
    expect(counts).toEqual({ "needs-submitting": 1, upcoming: 1, submitted: 1, cancelled: 1 });
  });
});

describe("what each account manager owes", () => {
  it("gathers the owed ones under a name, with the oldest called out", () => {
    // "Six are unwritten" is a statistic. "Jace has two, the oldest 39 days"
    // is something somebody acts on before lunch.
    const piles = byOwner(
      [
        evaluation({ jobId: "a", assignedToId: "p1", assignedToName: "Jace", at: "2026-08-02T12:00:00Z" }),
        evaluation({ jobId: "b", assignedToId: "p1", assignedToName: "Jace", at: "2026-09-08T12:00:00Z" }),
        evaluation({ jobId: "c", assignedToId: "p1", assignedToName: "Jace", at: "2026-09-20T12:00:00Z" }),
      ],
      NOW
    );
    expect(piles).toHaveLength(1);
    expect(piles[0]).toMatchObject({ name: "Jace", owed: 2, oldestDays: 39, upcoming: 1 });
  });

  it("puts whoever owes the most first", () => {
    const piles = byOwner(
      [
        evaluation({ jobId: "a", assignedToId: "p1", assignedToName: "Jace", at: "2026-09-01T12:00:00Z" }),
        evaluation({ jobId: "b", assignedToId: "p2", assignedToName: "Travis", at: "2026-09-01T12:00:00Z" }),
        evaluation({ jobId: "c", assignedToId: "p2", assignedToName: "Travis", at: "2026-09-02T12:00:00Z" }),
      ],
      NOW
    );
    expect(piles[0].name).toBe("Travis");
  });

  it("gives unassigned ones their own pile rather than dropping them", () => {
    // An evaluation nobody owes is the one that never gets written at all.
    const piles = byOwner(
      [evaluation({ assignedToId: null, assignedToName: null, at: "2026-09-01T12:00:00Z" })],
      NOW
    );
    expect(piles[0].name).toBe("Nobody assigned");
    expect(piles[0].owed).toBe(1);
  });

  it("leaves out the ones already submitted, which nobody owes anything on", () => {
    expect(byOwner([evaluation({ hasProposal: true })], NOW)).toEqual([]);
  });
});
