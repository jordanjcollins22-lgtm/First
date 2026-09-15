import { describe, expect, it } from "vitest";

import {
  assessLead,
  calibrateFromHistory,
  DEFAULT_CALIBRATION,
  estimateTicket,
  TARGET_TICKET,
  type LeadInput,
} from "@/lib/leads";

const TODAY = new Date("2026-08-17T12:00:00Z");

function lead(overrides: Partial<LeadInput> = {}): LeadInput {
  return {
    jobStatus: "estimating",
    proposalStatus: null,
    proposalTotal: null,
    evaluationStatus: null,
    evaluationDate: null,
    lastActivity: null,
    acreage: null,
    ...overrides,
  };
}

describe("calibrateFromHistory", () => {
  it("keeps the documented default until there's real history", () => {
    expect(calibrateFromHistory([])).toEqual(DEFAULT_CALIBRATION);
    expect(calibrateFromHistory([{ acreage: 1, total: 9000 }])).toEqual(DEFAULT_CALIBRATION);
  });

  it("derives dollars per acre once there's enough closed work", () => {
    const calibration = calibrateFromHistory([
      { acreage: 0.5, total: 4000 },
      { acreage: 1, total: 8000 },
      { acreage: 1, total: 8000 },
      { acreage: 2, total: 16000 },
      { acreage: 0.25, total: 2000 },
    ]);
    expect(calibration.perAcre).toBe(8000);
    expect(calibration.sampleSize).toBe(5);
  });

  it("is not dragged up by one estate job", () => {
    const withOutlier = calibrateFromHistory([
      { acreage: 1, total: 6000 },
      { acreage: 1, total: 6000 },
      { acreage: 1, total: 6000 },
      { acreage: 1, total: 6000 },
      { acreage: 1, total: 200000 },
    ]);
    // The median holds at the ordinary job, not the one-off.
    expect(withOutlier.perAcre).toBe(6000);
  });

  it("ignores jobs with no lot size or no total", () => {
    const calibration = calibrateFromHistory([
      { acreage: null, total: 9000 },
      { acreage: 1, total: 0 },
    ]);
    expect(calibration.sampleSize).toBe(0);
  });
});

describe("estimateTicket", () => {
  it("scales with the lot", () => {
    const half = estimateTicket(0.5, DEFAULT_CALIBRATION)!;
    const full = estimateTicket(1, DEFAULT_CALIBRATION)!;
    expect(full).toBeGreaterThan(half);
  });

  it("says nothing rather than guessing without a lot size", () => {
    expect(estimateTicket(null, DEFAULT_CALIBRATION)).toBeNull();
    expect(estimateTicket(0, DEFAULT_CALIBRATION)).toBeNull();
  });
});

describe("assessLead", () => {
  it("does not treat work in progress as a lead", () => {
    expect(assessLead(lead({ jobStatus: "in_progress" }), DEFAULT_CALIBRATION, TODAY).reason).toBeNull();
    expect(assessLead(lead({ jobStatus: "approved" }), DEFAULT_CALIBRATION, TODAY).reason).toBeNull();
  });

  it("ranks an unanswered quote above a cold property", () => {
    const pending = assessLead(
      lead({ proposalStatus: "sent", proposalTotal: 8000, lastActivity: "2026-08-10" }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    const cold = assessLead(lead({ acreage: 0.2 }), DEFAULT_CALIBRATION, TODAY);
    expect(pending.score).toBeGreaterThan(cold.score);
    expect(pending.reason).toBe("quote_pending");
  });

  it("uses the real quote rather than the estimate when there is one", () => {
    const assessment = assessLead(
      lead({ proposalStatus: "sent", proposalTotal: 12000, acreage: 0.1 }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    expect(assessment.ticket).toBe(12000);
    expect(assessment.ticketIsEstimate).toBe(false);
  });

  it("marks an estimate as an estimate", () => {
    const assessment = assessLead(lead({ acreage: 1.5 }), DEFAULT_CALIBRATION, TODAY);
    expect(assessment.ticketIsEstimate).toBe(true);
  });

  it("qualifies only at or above the target ticket", () => {
    expect(assessLead(lead({ proposalTotal: TARGET_TICKET }), DEFAULT_CALIBRATION, TODAY).qualifies).toBe(true);
    expect(assessLead(lead({ proposalTotal: 4999 }), DEFAULT_CALIBRATION, TODAY).qualifies).toBe(false);
  });

  it("leaves a client alone right after their job", () => {
    const justDone = assessLead(
      lead({ jobStatus: "completed", proposalTotal: 9000, lastActivity: "2026-08-01" }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    const ayearOn = assessLead(
      lead({ jobStatus: "completed", proposalTotal: 9000, lastActivity: "2025-08-01" }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    expect(ayearOn.score).toBeGreaterThan(justDone.score);
    expect(justDone.why).toContain("Worked recently — leave it a while");
  });

  it("recognises a visit that never got priced", () => {
    const assessment = assessLead(
      lead({ evaluationStatus: "completed", acreage: 1, lastActivity: "2026-08-05" }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    expect(assessment.reason).toBe("evaluated_no_quote");
  });

  it("explains itself", () => {
    const assessment = assessLead(
      lead({ proposalStatus: "sent", proposalTotal: 20000, lastActivity: "2026-08-15" }),
      DEFAULT_CALIBRATION,
      TODAY
    );
    expect(assessment.why).toContain("Well above the $5k target");
    expect(assessment.why).toContain("Still warm");
  });
});
