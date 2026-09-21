import { describe, expect, it } from "vitest";

import { addressKey, canDeleteJob, findDuplicates, type DuplicateCandidate } from "./duplicate-jobs";

function job(over: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    id: "a",
    address: "3 Idlewild Court, Bel Air, Maryland 21014, United States",
    customerName: "Daniel Piotrowski",
    createdAt: "2026-09-18T18:11:00Z",
    status: "estimating",
    evaluationStatus: "scheduled",
    proposalStatus: null,
    ...over,
  };
}

describe("addressKey", () => {
  it("reads one house from any spelling of its first line", () => {
    expect(addressKey("3 Idlewild Court, Bel Air, MD")).toBe("3 idlewild ct");
    expect(addressKey("3 Idlewild Ct., Bel Air, Maryland 21014")).toBe("3 idlewild ct");
    expect(addressKey("2802 Mountain Road, Joppa")).toBe("2802 mountain rd");
  });
});

describe("findDuplicates", () => {
  it("keeps the job furthest along and marks the rest as copies of it", () => {
    const quoted = job({ id: "q", status: "quoted", evaluationStatus: "completed", proposalStatus: "sent", createdAt: "2026-09-16T00:00:00Z" });
    const copy = job({ id: "c", createdAt: "2026-09-17T00:00:00Z" });
    const found = findDuplicates([copy, quoted]);
    expect(found.get("c")).toEqual({ keeperId: "q", keeperLabel: "Daniel Piotrowski" });
    expect(found.has("q")).toBe(false);
  });

  it("keeps the oldest when they are equally far along", () => {
    const first = job({ id: "first", createdAt: "2026-09-18T00:00:00Z" });
    const second = job({ id: "second", createdAt: "2026-09-19T00:00:00Z" });
    expect(findDuplicates([second, first]).get("second")?.keeperId).toBe("first");
  });

  it("leaves alone a second job somebody said is more work", () => {
    const first = job({ id: "first", createdAt: "2026-09-01T00:00:00Z", status: "approved" });
    const more = job({ id: "more", createdAt: "2026-09-21T00:00:00Z", duplicateClearedAt: "2026-09-21T20:48:00Z" });
    expect(findDuplicates([first, more]).size).toBe(0);
  });

  it("does not pair different people at one address, nor cancelled jobs", () => {
    const tenant = job({ id: "t", customerName: "Someone Else" });
    const cancelled = job({ id: "x", status: "cancelled" });
    expect(findDuplicates([job({}), tenant, cancelled]).size).toBe(0);
  });
});

describe("canDeleteJob", () => {
  const clean = { payments: 0, invoices: 0, proposalStatus: null, workSessions: 0, timeEntries: 0 };
  it("lets a bare booking go", () => {
    expect(canDeleteJob(clean)).toEqual({ ok: true });
    expect(canDeleteJob({ ...clean, proposalStatus: "sent" })).toEqual({ ok: true });
  });
  it("refuses anything with money or work on it", () => {
    expect(canDeleteJob({ ...clean, payments: 1 }).ok).toBe(false);
    expect(canDeleteJob({ ...clean, invoices: 1 }).ok).toBe(false);
    expect(canDeleteJob({ ...clean, proposalStatus: "accepted" }).ok).toBe(false);
    expect(canDeleteJob({ ...clean, workSessions: 1 }).ok).toBe(false);
  });
});
