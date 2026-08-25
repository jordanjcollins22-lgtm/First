import { describe, expect, it } from "vitest";

import { buildMyWork } from "@/lib/my-work";
import type { DashboardJobInput } from "@/lib/dashboard";

const TODAY = new Date(2026, 7, 19, 9, 0, 0);

function job(overrides: Partial<DashboardJobInput> = {}): DashboardJobInput {
  return {
    id: "j1",
    jobNumber: 1,
    jobName: "Front beds",
    customerName: "Pat Rivera",
    address: "208 Crafton Rd",
    status: "estimating",
    evaluationStatus: "scheduled",
    evaluationDate: null,
    projectStartDate: null,
    projectEndDate: null,
    completedAt: null,
    cancelledAt: null,
    proposalStatus: null,
    value: null,
    personName: "Mike",
    ...overrides,
  };
}

/** Noon local, so a day key is unambiguous either side of the date line. */
function at(day: number): string {
  return new Date(2026, 7, day, 12, 0, 0).toISOString();
}

describe("buildMyWork — upcoming evaluations", () => {
  it("lists a visit booked for a future day", () => {
    const { upcoming } = buildMyWork([job({ evaluationDate: at(21) })], TODAY);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].isToday).toBe(false);
  });

  it("counts today as upcoming — it is, right up until it is over", () => {
    const { upcoming } = buildMyWork([job({ evaluationDate: at(19) })], TODAY);
    expect(upcoming[0].isToday).toBe(true);
  });

  it("leaves out a visit already completed", () => {
    const done = job({ evaluationDate: at(21), evaluationStatus: "completed" });
    expect(buildMyWork([done], TODAY).upcoming).toEqual([]);
  });

  it("leaves out a cancelled visit and a cancelled job", () => {
    expect(buildMyWork([job({ evaluationDate: at(21), evaluationStatus: "cancelled" })], TODAY).upcoming).toEqual([]);
    expect(buildMyWork([job({ evaluationDate: at(21), status: "cancelled" })], TODAY).upcoming).toEqual([]);
  });

  it("keeps one already under way — on the way still counts as coming", () => {
    const rolling = job({ evaluationDate: at(19), evaluationStatus: "on_way" });
    expect(buildMyWork([rolling], TODAY).upcoming).toHaveLength(1);
  });

  it("puts the soonest first", () => {
    const jobs = [
      job({ id: "late", evaluationDate: at(25) }),
      job({ id: "soon", evaluationDate: at(20) }),
    ];
    expect(buildMyWork(jobs, TODAY).upcoming.map((u) => u.jobId)).toEqual(["soon", "late"]);
  });
});

describe("buildMyWork — what is owed", () => {
  it("catches a visit that happened and was never closed out", () => {
    // Nothing downstream unlocks until somebody marks it done, and no other
    // screen says so — the job looks healthy from every other angle.
    const { submissions } = buildMyWork([job({ evaluationDate: at(12) })], TODAY);
    expect(submissions[0]).toMatchObject({ reason: "close_out", daysWaiting: 7 });
  });

  it("catches an evaluated job nobody has priced", () => {
    const evaluated = job({ evaluationDate: at(12), evaluationStatus: "completed" });
    expect(buildMyWork([evaluated], TODAY).submissions[0]).toMatchObject({ reason: "price_it" });
  });

  it("catches a proposal built but never sent", () => {
    const priced = job({
      evaluationDate: at(12),
      evaluationStatus: "completed",
      proposalStatus: "needs_approval",
    });
    expect(buildMyWork([priced], TODAY).submissions[0]).toMatchObject({ reason: "send_it" });
  });

  it("gives one instruction per job, not two", () => {
    // Telling somebody to price a job they have not closed out yet is two
    // instructions for one action.
    const stale = job({ evaluationDate: at(12), proposalStatus: "needs_approval" });
    const { submissions } = buildMyWork([stale], TODAY);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].reason).toBe("close_out");
  });

  it("says nothing is owed once the proposal is out", () => {
    const sent = job({ evaluationDate: at(12), evaluationStatus: "completed", proposalStatus: "sent" });
    expect(buildMyWork([sent], TODAY).submissions).toEqual([]);
  });

  it("stops chasing a finished job", () => {
    const done = job({ evaluationDate: at(12), evaluationStatus: "completed", status: "completed" });
    expect(buildMyWork([done], TODAY).submissions).toEqual([]);
  });

  it("orders by stage, then by whichever has been sitting longest", () => {
    const jobs = [
      job({ id: "fresh", evaluationDate: at(18) }),
      job({ id: "stale", evaluationDate: at(5) }),
      job({ id: "priced", evaluationDate: at(12), evaluationStatus: "completed", proposalStatus: "needs_approval" }),
    ];
    expect(buildMyWork(jobs, TODAY).submissions.map((s) => s.jobId)).toEqual(["stale", "fresh", "priced"]);
  });
});

describe("buildMyWork — jobs being managed", () => {
  it("lists live work and leaves finished work out", () => {
    const jobs = [
      job({ id: "on-site", status: "in_progress", projectStartDate: "2026-08-19" }),
      job({ id: "done", status: "completed" }),
    ];
    expect(buildMyWork(jobs, TODAY).managed.map((m) => m.jobId)).toEqual(["on-site"]);
  });

  it("leaves out a job still out for a decision — that is the client's move", () => {
    const quoted = job({ status: "quoted", proposalStatus: "sent" });
    expect(buildMyWork([quoted], TODAY).managed).toEqual([]);
  });

  it("leads with what is on site, then what is late, then what is booked", () => {
    const jobs = [
      job({ id: "booked", status: "approved", projectStartDate: "2026-08-25" }),
      job({ id: "unbooked", status: "approved" }),
      job({ id: "late", status: "in_progress", projectEndDate: "2026-08-10" }),
      job({ id: "on-site", status: "in_progress", projectEndDate: "2026-08-25" }),
    ];
    expect(buildMyWork(jobs, TODAY).managed.map((m) => m.jobId)).toEqual([
      "on-site",
      "late",
      "booked",
      "unbooked",
    ]);
  });

  it("carries the value through for the ones that have one", () => {
    const booked = job({ status: "approved", projectStartDate: "2026-08-25", value: 4200 });
    expect(buildMyWork([booked], TODAY).managed[0].value).toBe(4200);
  });
});
