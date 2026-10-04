import { describe, expect, it } from "vitest";

import { broughtInRows, broughtInStep, upcoming, type BroughtInJob } from "@/lib/brought-in";

const job = (over: Partial<BroughtInJob>): BroughtInJob => ({
  jobId: "j",
  client: "Sample Client",
  address: "1 Sample Ln",
  jobStatus: "estimating",
  evaluationDate: null,
  proposalStatus: null,
  price: null,
  createdAt: "2026-10-01T12:00:00Z",
  ...over,
});

describe("broughtInStep", () => {
  it("follows a lead from new to done", () => {
    expect(broughtInStep(job({}))).toBe("lead");
    expect(broughtInStep(job({ evaluationDate: "2026-10-06T14:00:00Z" }))).toBe("evaluation");
    expect(broughtInStep(job({ proposalStatus: "sent" }))).toBe("proposal");
    expect(broughtInStep(job({ proposalStatus: "accepted" }))).toBe("sold");
    expect(broughtInStep(job({ jobStatus: "completed" }))).toBe("done");
  });
  it("is lost when declined or cancelled", () => {
    expect(broughtInStep(job({ proposalStatus: "declined" }))).toBe("lost");
    expect(broughtInStep(job({ jobStatus: "cancelled" }))).toBe("lost");
  });
});

describe("broughtInRows", () => {
  it("works out their 4% once there is a price", () => {
    const [row] = broughtInRows([job({ proposalStatus: "sent", price: 2500 })]);
    expect(row.yours).toBe(100);
  });
  it("pays nothing on a lost job and nothing before a price", () => {
    expect(broughtInRows([job({ proposalStatus: "declined", price: 2500 })])[0].yours).toBeNull();
    expect(broughtInRows([job({})])[0].yours).toBeNull();
  });
  it("counts upcoming as everything not done or lost", () => {
    const rows = broughtInRows([job({ jobId: "a" }), job({ jobId: "b", jobStatus: "completed" }), job({ jobId: "c", proposalStatus: "declined" })]);
    expect(upcoming(rows).map((r) => r.jobId)).toEqual(["a"]);
  });
});
