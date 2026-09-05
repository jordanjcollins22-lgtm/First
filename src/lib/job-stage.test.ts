import { describe, expect, it } from "vitest";

import { capabilities, deriveStage, nextStep, workHasStarted, type StageInput } from "@/lib/job-stage";

function walk(overrides: Partial<NonNullable<StageInput["walkthroughs"]>[number]> = {}) {
  return {
    status: "requested" as const,
    requested_at: "2026-09-10T14:00:00Z",
    reviewed_at: null,
    review_notes: null,
    ...overrides,
  };
}

function job(overrides: Partial<StageInput> = {}): StageInput {
  return {
    status: "estimating",
    evaluationStatus: "scheduled",
    evaluationDate: null,
    proposalStatus: null,
    sessions: [],
    ...overrides,
  };
}

describe("deriveStage", () => {
  it("starts a fresh job at evaluation", () => {
    expect(deriveStage(job())).toBe("evaluation");
  });

  it("moves to pricing once the visit is done", () => {
    expect(deriveStage(job({ evaluationStatus: "completed" }))).toBe("pricing");
  });

  it("moves to booked in once the proposal is accepted", () => {
    expect(deriveStage(job({ evaluationStatus: "completed", proposalStatus: "accepted" }))).toBe("scheduled");
  });

  it("moves to working once somebody is actually on site", () => {
    expect(
      deriveStage(job({ status: "approved", sessions: [{ status: "in_progress" }] }))
    ).toBe("working");
  });

  it("counts a paused visit as work underway", () => {
    expect(deriveStage(job({ status: "approved", sessions: [{ status: "paused" }] }))).toBe("working");
  });

  it("does not count a merely booked visit as work underway", () => {
    // Booking a visit is not turning up to it.
    expect(deriveStage(job({ status: "approved", sessions: [{ status: "scheduled" }] }))).toBe("scheduled");
  });

  it("reports done and cancelled over everything else", () => {
    expect(deriveStage(job({ status: "completed" }))).toBe("done");
    expect(deriveStage(job({ status: "cancelled", sessions: [{ status: "done" }] }))).toBe("cancelled");
  });
});

describe("workHasStarted", () => {
  it("is false for a job nobody has been to", () => {
    expect(workHasStarted(job({ status: "approved", sessions: [{ status: "scheduled" }] }))).toBe(false);
  });

  it("is true once a visit is done, even if the job status lags", () => {
    expect(workHasStarted(job({ status: "approved", sessions: [{ status: "done" }] }))).toBe(true);
  });
});

describe("capabilities", () => {
  it("refuses an after photo before the evaluation is done", () => {
    // The case this whole module exists for.
    const caps = capabilities(job());
    expect(caps.photoAfter.available).toBe(false);
    expect(caps.photoAfter.available === false && caps.photoAfter.reason).toMatch(/start a visit/i);
  });

  it("refuses to sign off work nobody has started", () => {
    expect(capabilities(job({ status: "approved" })).signOff.available).toBe(false);
  });

  it("refuses to sign off work the account manager hasn't walked", () => {
    // The client should never be the first person to find a problem.
    const caps = capabilities(job({ status: "in_progress" }));
    expect(caps.signOff.available).toBe(false);
    expect(caps.signOff.available === false && caps.signOff.reason).toMatch(/account manager/i);
  });

  it("still refuses while the manager has been asked but not been out", () => {
    const caps = capabilities(job({ status: "in_progress", walkthroughs: [walk()] }));
    expect(caps.signOff.available).toBe(false);
    expect(caps.signOff.available === false && caps.signOff.reason).toMatch(/waiting on/i);
  });

  it("opens sign-off once the manager approves", () => {
    const caps = capabilities(
      job({ status: "in_progress", walkthroughs: [walk({ status: "approved", reviewed_at: "x" })] })
    );
    expect(caps.signOff.available).toBe(true);
  });

  it("reports the punch list when the manager sent it back", () => {
    const caps = capabilities(
      job({
        status: "in_progress",
        walkthroughs: [walk({ status: "rejected", reviewed_at: "x", review_notes: "Edging loose" })],
      })
    );
    expect(caps.signOff.available === false && caps.signOff.reason).toContain("Edging loose");
  });

  it("lets the crew ask for the walk once they are on site, and not before", () => {
    expect(capabilities(job({ status: "approved" })).requestWalkthrough.available).toBe(false);
    expect(capabilities(job({ status: "in_progress" })).requestWalkthrough.available).toBe(true);
  });

  it("refuses to price a job nobody has looked at", () => {
    const caps = capabilities(job());
    expect(caps.proposal.available).toBe(false);
    expect(caps.proposal.available === false && caps.proposal.reason).toMatch(/evaluation/i);
  });

  it("opens pricing once the evaluation is complete", () => {
    expect(capabilities(job({ evaluationStatus: "completed" })).proposal.available).toBe(true);
  });

  it("refuses to book the crew before the proposal is accepted", () => {
    const caps = capabilities(job({ evaluationStatus: "completed" }));
    expect(caps.visits.available).toBe(false);
    expect(caps.visits.available === false && caps.visits.reason).toMatch(/accepted/i);
  });

  it("opens visits once it is sold", () => {
    expect(capabilities(job({ evaluationStatus: "completed", proposalStatus: "accepted" })).visits.available).toBe(true);
  });

  it("opens before photos as soon as there is a visit to take them on", () => {
    expect(capabilities(job()).photoBefore.available).toBe(false);
    expect(capabilities(job({ evaluationDate: "2026-09-01T14:00:00Z" })).photoBefore.available).toBe(true);
  });

  it("opens during and after photos only once somebody is on site", () => {
    const onSite = job({ status: "approved", sessions: [{ status: "in_progress" }] });
    expect(capabilities(onSite).photoDuring.available).toBe(true);
    expect(capabilities(onSite).photoAfter.available).toBe(true);
  });

  it("keeps measuring open throughout, since scope changes", () => {
    expect(capabilities(job()).measure.available).toBe(true);
    expect(capabilities(job({ status: "completed" })).measure.available).toBe(true);
  });

  it("closes estimate booking once the visit has happened", () => {
    expect(capabilities(job({ evaluationStatus: "completed" })).scheduleEstimate.available).toBe(false);
  });

  it("refuses to invoice work that has not started", () => {
    expect(capabilities(job({ evaluationStatus: "completed", proposalStatus: "accepted" })).invoice.available).toBe(
      false
    );
  });

  it("locks everything on a cancelled job except its ticket history", () => {
    const cancelled = job({ status: "cancelled", sessions: [{ status: "done" }] });
    const caps = capabilities(cancelled);
    expect(caps.proposal.available).toBe(false);
    expect(caps.visits.available).toBe(false);
    expect(caps.signOff.available).toBe(false);
    // A cancelled job can still carry the record of why somebody went back.
    expect(caps.tickets.available).toBe(true);
  });

  it("gives a reason for every lock, never a bare refusal", () => {
    const caps = capabilities(job());
    for (const [name, verdict] of Object.entries(caps)) {
      if (!verdict.available) {
        expect(verdict.reason.length, `${name} locked with no reason`).toBeGreaterThan(10);
      }
    }
  });
});

describe("nextStep", () => {
  it("tells a fresh job to book the visit", () => {
    expect(nextStep(job())).toMatch(/book the evaluation/i);
  });

  it("tells a booked job to go and do it", () => {
    expect(nextStep(job({ evaluationDate: "2026-09-01T14:00:00Z" }))).toMatch(/evaluate/i);
  });

  it("says it is waiting on the client when the proposal is out", () => {
    expect(nextStep(job({ evaluationStatus: "completed", proposalStatus: "sent" }))).toMatch(/waiting on the client/i);
  });

  it("tells a live job to document and get the manager out", () => {
    expect(nextStep(job({ status: "in_progress" }))).toMatch(/manager out to approve/i);
  });

  it("tells a crew waiting on the manager to keep the tools out", () => {
    const waiting = job({ status: "in_progress", walkthroughs: [walk()] });
    expect(nextStep(waiting)).toMatch(/keep the tools out/i);
  });

  it("tells an approved job to sign off", () => {
    const approved = job({ status: "in_progress", walkthroughs: [walk({ status: "approved" })] });
    expect(nextStep(approved)).toMatch(/sign the job off/i);
  });
});

describe("a job already on the calendar stays fixable", () => {
  // The trap this closes: work dates showed as read-only, pointing at Visits,
  // while Visits itself was locked because the proposal wasn't accepted. Wrong
  // dates, no way to change them, no way out.
  it("locks visits on a fresh job that was never scheduled", () => {
    expect(capabilities(job({ evaluationStatus: "completed" })).visits.available).toBe(false);
  });

  it("still reports the lock reason so the page can decide to override it", () => {
    const caps = capabilities(job({ evaluationStatus: "completed" }));
    expect(caps.visits.available === false && caps.visits.reason).toMatch(/accepted/i);
  });

  it("opens visits once the job is sold, as before", () => {
    expect(
      capabilities(job({ evaluationStatus: "completed", proposalStatus: "accepted" })).visits.available
    ).toBe(true);
  });

  it("opens visits as soon as work has started, whatever the paperwork says", () => {
    // Booked and worked before the proposal was marked accepted happens, and
    // the crew still needs the day fixable.
    expect(
      capabilities(job({ status: "in_progress", sessions: [{ status: "in_progress" }] })).visits.available
    ).toBe(true);
  });
});
