import { describe, expect, it } from "vitest";

import { chainTriggered, planChain, type ChainFacts } from "./completion-chain";

const NOW = new Date("2026-10-13T16:00:00Z");
const settings = { invoiceAfterClientApproval: true, signoffOverdueHours: 72 };
const facts = (over: Partial<ChainFacts> = {}): ChainFacts => ({
  jobStatus: "in_progress",
  sessionsAllClosed: true,
  review: null,
  closeoutBlockedBy: null,
  clientHasEmail: true,
  invoice: "none",
  billedElsewhere: false,
  agreedCents: 500_000,
  snapshotAt: null,
  snapshotFinal: false,
  reviewReadyAt: null,
  leadNudgedAt: null,
  ...over,
});
const kinds = (f: ChainFacts, s = settings) => planChain(f, s, NOW).steps.map((x) => x.kind);

describe("chainTriggered", () => {
  it("starts on completion or on the last session closing", () => {
    expect(chainTriggered({ jobStatus: "completed", sessionsAllClosed: false })).toBe(true);
    expect(chainTriggered({ jobStatus: "in_progress", sessionsAllClosed: true })).toBe(true);
    expect(chainTriggered({ jobStatus: "in_progress", sessionsAllClosed: false })).toBe(false);
  });
});

describe("planChain", () => {
  it("sends the sign-off first and waits on the client before billing", () => {
    expect(kinds(facts())).toEqual(["send_signoff"]);
  });

  it("asks the lead to finish close-out when the sign-off can't go yet, once", () => {
    const blocked = facts({ closeoutBlockedBy: "Take the afters first." });
    const plan = planChain(blocked, settings, NOW);
    expect(plan.steps).toEqual([{ kind: "nudge_lead", reason: "Take the afters first." }]);
    expect(plan.exception).toContain("afters");
    expect(kinds(facts({ closeoutBlockedBy: "x", leadNudgedAt: "2026-10-12T00:00:00Z" }))).toEqual([]);
  });

  it("bills, snapshots and marks review-ready once the client approves", () => {
    const approved = facts({ review: { status: "approved", sentAt: "2026-10-12T00:00:00Z" } });
    expect(kinds(approved)).toEqual(["raise_invoice", "snapshot", "review_ready"]);
  });

  it("bills straight away when the business doesn't wait for approval", () => {
    expect(kinds(facts(), { ...settings, invoiceAfterClientApproval: false })).toEqual(["send_signoff", "raise_invoice", "snapshot"]);
  });

  it("never raises a second invoice, or one for work already paid for", () => {
    const approved = { review: { status: "approved" as const, sentAt: "2026-10-12T00:00:00Z" } };
    expect(kinds(facts({ ...approved, invoice: "open" }))).toEqual(["snapshot", "review_ready"]);
    expect(kinds(facts({ ...approved, billedElsewhere: true }))).toEqual(["snapshot", "review_ready"]);
    expect(kinds(facts({ ...approved, agreedCents: 0 }))).toEqual(["snapshot", "review_ready"]);
  });

  it("raises an exception when the client has sat on it past the limit", () => {
    const sent = facts({ review: { status: "sent", sentAt: "2026-10-10T15:00:00Z" } });
    expect(planChain(sent, settings, NOW).exception).toMatch(/hasn't signed off in 73 hours/);
    expect(planChain(facts({ review: { status: "sent", sentAt: "2026-10-12T15:00:00Z" } }), settings, NOW).exception).toBeNull();
  });

  it("re-snapshots once when the job is finally completed", () => {
    const done = facts({ jobStatus: "completed", review: { status: "approved", sentAt: "x" }, invoice: "open", snapshotAt: "2026-10-12T00:00:00Z", reviewReadyAt: "y" });
    expect(planChain(done, settings, NOW).steps).toEqual([{ kind: "snapshot", final: true }]);
    expect(kinds({ ...done, snapshotFinal: true })).toEqual([]);
  });

  it("marks review-ready on payment when the client never answered", () => {
    expect(kinds(facts({ review: { status: "sent", sentAt: "2026-10-13T00:00:00Z" }, invoice: "paid" }))).toEqual(["snapshot", "review_ready"]);
  });

  it("does not send a fresh sign-off for a job already completed", () => {
    expect(kinds(facts({ jobStatus: "completed", invoice: "paid" }))).toEqual(["snapshot", "review_ready"]);
  });
});
