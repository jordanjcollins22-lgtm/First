import { describe, expect, it } from "vitest";

import { rankEvaluators, type EvaluatorJob } from "./evaluation-leaderboard";

function job(over: Partial<EvaluatorJob>): EvaluatorJob {
  return {
    jobId: Math.random().toString(36).slice(2),
    clientName: "A Client",
    address: null,
    evaluationStatus: "completed",
    evaluationDate: "2026-09-01T14:00:00Z",
    proposalSentAt: "2026-09-03T14:00:00Z",
    proposalStatus: "sent",
    proposalTotal: 1000,
    acceptedAt: null,
    collected: 0,
    ...over,
  };
}

describe("rankEvaluators", () => {
  it("puts whoever closed the most first, then who sold the most", () => {
    const ranked = rankEvaluators([
      { profileId: "a", name: "Ann", jobs: [job({}), job({}), job({})] },
      { profileId: "b", name: "Bo", jobs: [job({ proposalStatus: "accepted", acceptedAt: "2026-09-04T00:00:00Z", proposalTotal: 650 })] },
      { profileId: "c", name: "Cy", jobs: [job({ proposalStatus: "accepted", acceptedAt: "2026-09-04T00:00:00Z", proposalTotal: 9000 })] },
    ]);
    expect(ranked.map((s) => `${s.rank} ${s.name}`)).toEqual(["1 Cy", "2 Bo", "3 Ann"]);
    expect(ranked[0].sold).toBe(9000);
  });

  it("counts visits, proposals, the wait between them, and what is still unwritten", () => {
    const [s] = rankEvaluators([
      {
        profileId: "a",
        name: "Ann",
        jobs: [
          job({ evaluationDate: "2026-09-01T14:00:00Z", proposalSentAt: "2026-09-03T14:00:00Z" }),
          job({ evaluationDate: "2026-09-01T14:00:00Z", proposalSentAt: "2026-09-05T14:00:00Z" }),
          job({ proposalSentAt: null, proposalStatus: null }),
          job({ evaluationStatus: "cancelled", proposalSentAt: null, proposalStatus: null }),
        ],
      },
    ]);
    expect(s.evaluations).toBe(3);
    expect(s.cancelled).toBe(1);
    expect(s.proposals).toBe(2);
    expect(s.daysToProposal).toBe(3);
    expect(s.awaitingProposal).toBe(1);
    expect(s.closeRate).toBeNull();
  });

  it("only gives a close rate once there are a few proposals to rate", () => {
    const [s] = rankEvaluators([
      { profileId: "a", name: "Ann", jobs: [job({ proposalStatus: "accepted" }), job({}), job({}), job({})] },
    ]);
    expect(s.closeRate).toBe(0.25);
  });

  it("keeps to the window when one is given", () => {
    const ranked = rankEvaluators(
      [{ profileId: "a", name: "Ann", jobs: [job({ evaluationDate: "2026-06-01T14:00:00Z" }), job({ evaluationDate: "2026-09-10T14:00:00Z" })] }],
      { since: new Date("2026-08-01T00:00:00Z") }
    );
    expect(ranked[0].evaluations).toBe(1);
  });

  it("leaves out anyone with nothing in the window", () => {
    expect(rankEvaluators([{ profileId: "a", name: "Ann", jobs: [] }])).toEqual([]);
  });
});
