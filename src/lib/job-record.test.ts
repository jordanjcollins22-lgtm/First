import { describe, expect, it } from "vitest";

import {
  askedNotQuoted,
  buildJobRecord,
  moneyOf,
  proposalOutcome,
  recordFileName,
  removedLines,
  timelineOf,
  type JobRecordInput,
  type RecordChange,
  type RecordZone,
} from "@/lib/job-record";

const ZONE: RecordZone = {
  name: "Front beds",
  service: "Mulch bed",
  scopeText: "Edge, weed and top up with 3 inches of dark hardwood mulch.",
  priceCents: 80_000,
  performedBy: "own",
  partnerName: null,
};

const SOD: RecordZone = {
  name: "Back lawn",
  service: "Sod installation",
  scopeText: "Strip, grade and lay tall fescue sod.",
  priceCents: 260_000,
  performedBy: "own",
  partnerName: null,
};

function change(overrides: Partial<RecordChange> = {}): RecordChange {
  return {
    requestedAt: "2026-09-05T10:00:00Z",
    requestedByName: "Yvonne",
    requestedNote: "Client wants the side path pressure washed",
    status: "sent_to_client",
    statusLabel: "With the client",
    priceCents: 15_000,
    terms: null,
    reviewNote: null,
    clientDecision: null,
    clientDecisionAt: null,
    clientDecisionNote: null,
    clientDecisionChannel: null,
    executableAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<JobRecordInput> = {}): JobRecordInput {
  return {
    generatedAt: "2026-09-11T20:00:00Z",
    siteMap: null,
    business: { name: "JS Landscaping MD", phone: null, email: null, address: null, website: null },
    job: {
      number: "#0033",
      name: "Front beds",
      status: "approved",
      evaluationDate: "2026-08-20T14:00:00Z",
      evaluationStatus: "completed",
      projectStart: "2026-09-08",
      projectEnd: "2026-09-09",
      completedAt: null,
      completedByName: null,
      completionNotes: null,
      clientNotes: "Please keep the dog gate shut",
      budgetRange: null,
      cancelledAt: null,
      cancellationReason: null,
      declinedAt: null,
      declinedReason: null,
      disputeOpenedAt: null,
      disputeKind: null,
      disputeReason: null,
    },
    customer: { name: "Devin Secore", phone: null, email: null },
    address: "3501 Woodbrook Court, Abingdon, MD 21009",
    accountManager: { name: "Jordan Collins", phone: null },
    requestedServices: [],
    proposal: {
      status: "accepted",
      totalCost: 3_400,
      discountAmount: 0,
      discountReason: null,
      generatedAt: "2026-08-21T09:00:00Z",
      approvedAt: "2026-08-21T10:00:00Z",
      respondedAt: "2026-08-23T18:10:00Z",
      responseNote: null,
      paymentPath: "full",
      clientChosenDay: null,
      paidAt: null,
      zones: [ZONE, SOD],
      recommendedScope: null,
    },
    trims: [],
    scopeRequests: [],
    changes: [],
    messages: [],
    objections: [],
    evalEdits: [],
    visits: [],
    tickets: [],
    walkthroughs: [],
    issues: [],
    exceptions: [],
    payments: [],
    invoices: [],
    photos: [],
    marks: [],
    reading: null,
    ...overrides,
  };
}

describe("what was agreed", () => {
  it("groups the accepted areas by service and carries the terms and expectations they saw", () => {
    const record = buildJobRecord(input());
    expect(record.agreed?.groups.map((g) => g.service)).toEqual(["Mulch bed", "Sod installation"]);
    expect(record.agreed?.totalCents).toBe(340_000);
    expect(record.agreed?.terms.length).toBeGreaterThan(0);
    // Sod was on the job, so the sod expectation was on their proposal.
    expect(record.agreed?.expectations.some((e) => /sod/i.test(e.heading))).toBe(true);
    expect(record.agreed?.outcome).toMatch(/^Accepted /);
  });

  it("says plainly when there was never a proposal", () => {
    const record = buildJobRecord(input({ proposal: null }));
    expect(record.agreed).toBeNull();
    expect(record.walkNotes[0]).toMatch(/No proposal was ever written/);
  });

  it("describes an unanswered proposal as unanswered", () => {
    expect(proposalOutcome({ status: "sent", respondedAt: null, approvedAt: "2026-08-21T10:00:00Z" })).toBe(
      "Sent, not yet answered"
    );
  });
});

describe("what was not included", () => {
  it("lists what came off the proposal, with the date and who asked", () => {
    const lines = removedLines(
      [
        {
          at: "2026-08-22T15:00:00Z",
          byName: "Jordan",
          removedZones: [{ zoneName: "Side bed", serviceLabel: "Mulch bed", priceCents: 40_000 }],
          removedLines: [{ zoneName: "Front beds", line: "Plant three boxwoods" }],
          previousTotalCents: 380_000,
          newTotalCents: 340_000,
          note: null,
          requestedVia: "text",
        },
      ],
      [{ at: "2026-08-23T09:00:00Z", kept: ["Front beds"], dropped: ["Back lawn"], status: "applied", previousTotalCents: null, newTotalCents: null }]
    );
    expect(lines).toEqual([
      "Aug 22, 2026: Side bed (Mulch bed, $400.00) taken off (asked by text).",
      'Aug 22, 2026: "Plant three boxwoods" taken out of Front beds (asked by text).',
      "Aug 23, 2026: client dropped Back lawn from the proposal page.",
    ]);
  });

  it("finds what they asked for at booking that never made the proposal", () => {
    expect(askedNotQuoted(["Mulching", "Tree removal", "Sod"], [ZONE, SOD])).toEqual(["Tree removal"]);
  });

  it("puts declined and rejected change requests under not included, approved ones under added later", () => {
    const record = buildJobRecord(
      input({
        changes: [
          change({ clientDecision: "declined", status: "client_declined" }),
          change({ requestedNote: "Add a second coat of sealant", status: "rejected" }),
          change({ requestedNote: "Pressure wash the steps", clientDecision: "approved", status: "client_approved", priceCents: 20_000, executableAt: "2026-09-06T10:00:00Z" }),
          change({ requestedNote: "Still thinking", status: "sent_to_client" }),
        ],
      })
    );
    expect(record.notIncluded.declined.map((c) => c.requestedNote)).toEqual([
      "Client wants the side path pressure washed",
      "Add a second coat of sealant",
    ]);
    expect(record.addedLater.map((c) => c.requestedNote)).toEqual(["Pressure wash the steps"]);
    expect(record.pendingChanges.map((c) => c.requestedNote)).toEqual(["Still thinking"]);
    expect(record.money.addedCents).toBe(20_000);
  });

  it("always states the rule, even on a job where nothing was removed", () => {
    expect(buildJobRecord(input()).notIncluded.rule.length).toBe(2);
  });
});

describe("money", () => {
  it("adds approved extras to the quote and nets payments against it", () => {
    const money = moneyOf({
      proposal: input().proposal,
      changes: [change({ clientDecision: "approved", priceCents: 20_000 })],
      payments: [{ at: "2026-09-10T12:00:00Z", amountCents: 100_000, method: "card", receiptNumber: "R-2026-0001", reference: null }],
      invoices: [],
    });
    expect(money.dueCents).toBe(360_000);
    expect(money.paidCents).toBe(100_000);
    expect(money.outstandingCents).toBe(260_000);
  });

  it("never reports a negative balance when they overpaid", () => {
    const money = moneyOf({
      proposal: input().proposal,
      changes: [],
      payments: [{ at: "2026-09-10T12:00:00Z", amountCents: 400_000, method: "check", receiptNumber: null, reference: null }],
      invoices: [],
    });
    expect(money.outstandingCents).toBe(0);
  });
});

describe("the client copy", () => {
  const base = input({
    messages: [
      { at: "2026-08-24T10:00:00Z", from: "client", name: "Devin Secore", channel: "Proposal page", body: "Can you start Monday?", reference: null, internal: false },
      { at: "2026-08-24T10:05:00Z", from: "team", name: "Jordan", channel: "Team note", body: "Pushed back on price, be firm", reference: null, internal: true },
    ],
    marks: [{ note: "Sprinkler head here, careful", authorName: "Yvonne", createdAt: "2026-08-20T14:30:00Z" }],
    reading: { opens: 3, firstAt: "2026-08-21T12:00:00Z", lastAt: "2026-08-23T18:00:00Z", totalSeconds: 240, focus: "Scope of work" },
  });

  it("keeps the team's notes, marks and reading on the full copy", () => {
    const full = buildJobRecord(base);
    expect(full.internalNotes).toHaveLength(1);
    expect(full.marks).toHaveLength(1);
    expect(full.reading?.opens).toBe(3);
    expect(full.timeline.some((e) => e.internal)).toBe(true);
    expect(full.walkNotes.some((n) => /opened the proposal 3 times/.test(n))).toBe(true);
  });

  it("strips every team-only line from the client copy", () => {
    const client = buildJobRecord(base, { clientCopy: true });
    expect(client.clientCopy).toBe(true);
    expect(client.internalNotes).toEqual([]);
    expect(client.marks).toEqual([]);
    expect(client.reading).toBeNull();
    expect(client.walkNotes).toEqual([]);
    expect(client.timeline.some((e) => e.internal)).toBe(false);
    // What the client themselves said is still there.
    expect(client.communications).toHaveLength(1);
  });
});

describe("the timeline", () => {
  it("puts everything in the order it happened", () => {
    const entries = timelineOf(
      input({
        payments: [{ at: "2026-09-10T12:00:00Z", amountCents: 100_000, method: "card", receiptNumber: null, reference: null }],
        tickets: [{ at: "2026-09-12T09:00:00Z", title: "Mulch washed out", detail: null, cause: "weather", severity: "minor", status: "open", billable: false, resolution: null, resolvedAt: null }],
      })
    );
    const whats = entries.map((e) => e.what);
    expect(whats[0]).toBe("Evaluation visit");
    expect(whats.indexOf("Proposal written")).toBeLessThan(whats.indexOf("Client accepted the proposal"));
    expect(whats.indexOf("Payment received")).toBeLessThan(whats.indexOf("Callback: Mulch washed out"));
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].at >= entries[i - 1].at).toBe(true);
    }
  });
});

describe("walk notes", () => {
  it("leads with the balance and the open callback, the two things the conversation turns on", () => {
    const record = buildJobRecord(
      input({
        payments: [{ at: "2026-09-10T12:00:00Z", amountCents: 100_000, method: "card", receiptNumber: null, reference: null }],
        tickets: [{ at: "2026-09-12T09:00:00Z", title: "Mulch washed out", detail: null, cause: "weather", severity: "minor", status: "open", billable: false, resolution: null, resolvedAt: null }],
      })
    );
    expect(record.walkNotes.some((n) => n === "Open callback: Mulch washed out.")).toBe(true);
    expect(record.walkNotes.some((n) => n === "Balance outstanding: $2,400.00 of $3,400.00.")).toBe(true);
  });
});

describe("file name", () => {
  it("names the download after the job and the client", () => {
    expect(recordFileName({ number: "#0033" }, "Devin Secore")).toBe("job-record-0033-devin-secore.pdf");
    expect(recordFileName({ number: null }, "")).toBe("job-record-client.pdf");
  });
});
