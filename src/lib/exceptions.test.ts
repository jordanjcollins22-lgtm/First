import { describe, expect, it } from "vitest";

import {
  blocksSending,
  canDecideException,
  canMoveException,
  canMoveScopeChange,
  canReviewScopeChange,
  canWaiveClientApproval,
  DECIDED_BY,
  EXCEPTION_KINDS,
  isExecutable,
  isScopeChangeOpen,
  KIND_LABEL,
  KIND_MEANS,
  OPENS_A_CHANGE_REQUEST,
  progressNeedsReason,
  SCOPE_CHANGE_STATUSES,
  STOPS_WORK_BY_DEFAULT,
  summariseProgress,
  waitingOn,
  type ProgressUnit,
  type ScopeChangeShape,
} from "./exceptions";

describe("the thirteen kinds", () => {
  it("is thirteen, and every one is spelled out", () => {
    expect(EXCEPTION_KINDS).toHaveLength(13);
    for (const kind of EXCEPTION_KINDS) {
      expect(KIND_LABEL[kind], `${kind} has no label`).toBeTruthy();
      expect(KIND_MEANS[kind], `${kind} has no explanation`).toBeTruthy();
      expect(DECIDED_BY[kind], `${kind} is nobody's decision`).toBeTruthy();
      expect(typeof STOPS_WORK_BY_DEFAULT[kind]).toBe("boolean");
    }
  });

  it("routes anything touching what the client buys to the account manager", () => {
    expect(DECIDED_BY.change_request).toBe("account-manager");
    expect(DECIDED_BY.instruction_conflict).toBe("account-manager");
    expect(DECIDED_BY.cancellation).toBe("account-manager");
    expect(DECIDED_BY.cannot_perform).toBe("account-manager");
  });

  it("leaves the running of the day to the project lead", () => {
    expect(DECIDED_BY.equipment_failure).toBe("project-lead");
    expect(DECIDED_BY.weather_interruption).toBe("project-lead");
    expect(DECIDED_BY.late_start).toBe("project-lead");
  });

  it("only opens a change request for the kinds that change what was sold", () => {
    expect(OPENS_A_CHANGE_REQUEST).toEqual(["change_request", "instruction_conflict"]);
  });

  it("does not treat a broken mower as a stopped crew by default", () => {
    // They fetch the other one. A locked gate is a different matter.
    expect(STOPS_WORK_BY_DEFAULT.equipment_failure).toBe(false);
    expect(STOPS_WORK_BY_DEFAULT.access_failure).toBe(true);
  });
});

describe("moving an exception along", () => {
  it("goes reported → acknowledged → resolved", () => {
    expect(canMoveException("reported", "acknowledged")).toBe(true);
    expect(canMoveException("acknowledged", "resolved")).toBe(true);
  });

  it("lets an obvious one be settled straight from reported", () => {
    expect(canMoveException("reported", "resolved")).toBe(true);
  });

  it("never reopens a closed one, so the first decision stays readable", () => {
    expect(canMoveException("resolved", "acknowledged")).toBe(false);
    expect(canMoveException("dismissed", "reported")).toBe(false);
  });
});

describe("who may decide", () => {
  it("lets the owner settle anything", () => {
    for (const kind of EXCEPTION_KINDS) {
      expect(canDecideException(["owner"], kind)).toBe(true);
    }
  });

  it("does not let a technician settle their own report", () => {
    expect(canDecideException(["project-technician"], "equipment_failure")).toBe(false);
    expect(canDecideException(["project-technician"], "change_request")).toBe(false);
  });

  it("does not let a project lead decide what the client is buying", () => {
    expect(canDecideException(["project-lead"], "equipment_failure")).toBe(true);
    expect(canDecideException(["project-lead"], "change_request")).toBe(false);
    expect(canDecideException(["project-lead"], "cancellation")).toBe(false);
  });

  it("lets an account manager cover a lead's kinds, but not the other way round", () => {
    expect(canDecideException(["account-manager"], "equipment_failure")).toBe(true);
    expect(canDecideException(["account-manager"], "change_request")).toBe(true);
    expect(canDecideException(["project-lead"], "partial_completion")).toBe(false);
  });

  it("keeps reviewing and pricing a change out of the field entirely", () => {
    expect(canReviewScopeChange(["project-lead"])).toBe(false);
    expect(canReviewScopeChange(["project-technician"])).toBe(false);
    expect(canReviewScopeChange(["account-manager"])).toBe(true);
    expect(canReviewScopeChange(["owner"])).toBe(true);
  });
});

describe("the change request pipeline", () => {
  const base: ScopeChangeShape = {
    status: "reported",
    reviewedAt: null,
    priceCents: null,
    pricedAt: null,
    clientApprovalRequired: true,
    approvalWaivedReason: null,
    clientDecision: null,
    executableAt: null,
  };

  it("has a status for every state the database allows", () => {
    expect(SCOPE_CHANGE_STATUSES).toHaveLength(9);
  });

  it("cannot jump from the field straight to the client", () => {
    expect(canMoveScopeChange("reported", "sent_to_client")).toBe(false);
    expect(canMoveScopeChange("reported", "client_approved")).toBe(false);
  });

  it("cannot be approved out of nowhere", () => {
    expect(canMoveScopeChange("reported", "client_approved")).toBe(false);
    expect(canMoveScopeChange("in_review", "client_approved")).toBe(true);
  });

  it("lets a free change skip pricing but never the review", () => {
    expect(canMoveScopeChange("in_review", "sent_to_client")).toBe(true);
    expect(canMoveScopeChange("reported", "priced")).toBe(false);
  });

  it("closes for good once the client has decided, except to be superseded", () => {
    expect(canMoveScopeChange("client_approved", "in_review")).toBe(false);
    expect(canMoveScopeChange("client_approved", "superseded")).toBe(true);
    expect(canMoveScopeChange("rejected", "in_review")).toBe(false);
  });

  it("says whose desk it is on", () => {
    expect(waitingOn("reported")).toBe("account-manager");
    expect(waitingOn("sent_to_client")).toBe("client");
    expect(waitingOn("client_approved")).toBeNull();
  });

  it("counts the ones still going somewhere", () => {
    expect(isScopeChangeOpen("in_review")).toBe(true);
    expect(isScopeChangeOpen("client_approved")).toBe(false);
    expect(isScopeChangeOpen("withdrawn")).toBe(false);
  });

  it("will not let a crew do work that has only been reported", () => {
    expect(isExecutable(base)).toBe(false);
    expect(isExecutable({ ...base, status: "in_review", reviewedAt: "2026-01-01" })).toBe(false);
    expect(isExecutable({ ...base, status: "sent_to_client", reviewedAt: "2026-01-01" })).toBe(false);
  });

  it("only calls it executable once it is approved and stamped", () => {
    const approved: ScopeChangeShape = {
      ...base,
      status: "client_approved",
      reviewedAt: "2026-01-01",
      clientDecision: "approved",
      executableAt: "2026-01-02",
    };
    expect(isExecutable(approved)).toBe(true);
    // Approved but never stamped is not executable: the stamp is what the
    // trigger writes, and a hand-made row without it is not a decision.
    expect(isExecutable({ ...approved, executableAt: null })).toBe(false);
  });

  it("will not send an unreviewed change to a client", () => {
    expect(blocksSending(base)).toBe("An account manager has not reviewed it yet.");
  });

  it("will not send a change nobody has priced or called free", () => {
    expect(blocksSending({ ...base, status: "in_review", reviewedAt: "2026-01-01" })).toBe(
      "No price yet, and nobody has said it is free."
    );
  });

  it("treats a deliberate zero as a price", () => {
    expect(
      blocksSending({ ...base, status: "in_review", reviewedAt: "2026-01-01", priceCents: 0, pricedAt: "2026-01-01" })
    ).toBeNull();
    // Free, said out loud: priced with no number.
    expect(
      blocksSending({ ...base, status: "in_review", reviewedAt: "2026-01-01", pricedAt: "2026-01-01" })
    ).toBeNull();
  });

  it("never waives the client's yes on something they are being charged for", () => {
    expect(canWaiveClientApproval(null)).toBe(true);
    expect(canWaiveClientApproval(0)).toBe(true);
    expect(canWaiveClientApproval(1)).toBe(false);
    expect(canWaiveClientApproval(25000)).toBe(false);
  });
});

describe("partial completion", () => {
  const unit = (state: ProgressUnit["state"], key: string): ProgressUnit => ({
    unitKind: "zone",
    unitKey: key,
    unitLabel: key,
    state,
    portionPct: null,
    note: state === "complete" || state === "not_started" || state === "in_progress" ? null : "flooded",
  });

  it("makes anything short of done say why", () => {
    expect(progressNeedsReason("partial")).toBe(true);
    expect(progressNeedsReason("cannot_perform")).toBe(true);
    expect(progressNeedsReason("skipped")).toBe(true);
    expect(progressNeedsReason("complete")).toBe(false);
    expect(progressNeedsReason("not_started")).toBe(false);
  });

  it("separates 'all done' from 'all accounted for'", () => {
    const three = [unit("complete", "a"), unit("complete", "b"), unit("complete", "c")];
    const withOneFlooded = [...three, unit("cannot_perform", "d")];
    expect(summariseProgress(three).fullyDone).toBe(true);
    expect(summariseProgress(withOneFlooded).fullyDone).toBe(false);
    expect(summariseProgress(withOneFlooded).accountedFor).toBe(true);
  });

  it("does not call a job with an untouched zone accounted for", () => {
    const s = summariseProgress([unit("complete", "a"), unit("not_started", "b")]);
    expect(s.accountedFor).toBe(false);
    expect(s.sentence).toBe("1 of 2 done, 1 still open.");
  });

  it("says what happened rather than a percentage", () => {
    expect(summariseProgress([unit("complete", "a"), unit("partial", "b")]).sentence).toBe(
      "1 of 2 done, 1 recorded short."
    );
    expect(summariseProgress([unit("complete", "a")]).sentence).toBe("All 1 done.");
  });

  it("has nothing to say about a job with no units", () => {
    const s = summariseProgress([]);
    expect(s.sentence).toBeNull();
    expect(s.fullyDone).toBe(false);
    expect(s.accountedFor).toBe(false);
  });
});
