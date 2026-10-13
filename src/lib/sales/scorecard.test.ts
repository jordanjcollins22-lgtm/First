import { describe, expect, it } from "vitest";

import { buildScorecard, closeRateTone, teamTotals, type ScorecardJob } from "@/lib/sales/scorecard";
import { KPI_BANDS, salesKpis, toneFor } from "@/lib/sales/sales-kpis";

const now = new Date("2026-10-13T20:00:00.000Z");
const job = (over: Partial<ScorecardJob> = {}): ScorecardJob => ({
  evaluatorId: "a",
  evaluationDate: "2026-10-01T14:00:00.000Z",
  evaluationStatus: "completed",
  submittedAt: "2026-10-01T15:00:00.000Z",
  proposalStatus: null,
  sentAt: null,
  proposalTotal: null,
  collected: 0,
  ...over,
});

describe("the evaluator scorecard", () => {
  const rows = buildScorecard(
    [
      { id: "a", name: "Jace" },
      { id: "b", name: "Sam" },
      { id: "c", name: "Nobody" },
    ],
    [
      job({ proposalStatus: "accepted", sentAt: "2026-10-01T16:00:00.000Z", proposalTotal: 4000, collected: 1000 }),
      job({ proposalStatus: "accepted", sentAt: "2026-10-01T20:00:00.000Z", proposalTotal: 6000 }),
      job({ proposalStatus: "declined", sentAt: "2026-10-01T15:30:00.000Z", proposalTotal: 3000 }),
      // A no-show: due, never submitted.
      job({ evaluationStatus: "scheduled", submittedAt: null }),
      job({ evaluationStatus: "cancelled", submittedAt: null }),
      // Still to come: not a visit yet.
      job({ evaluationDate: "2026-10-20T14:00:00.000Z", evaluationStatus: "scheduled", submittedAt: null }),
      job({ evaluatorId: "b", proposalStatus: "declined", sentAt: "2026-10-02T15:00:00.000Z", proposalTotal: 2000 }),
    ],
    { now, speedTargetHours: 2, commissionPct: 4 }
  );
  const jace = rows.find((r) => r.evaluatorId === "a")!;

  it("counts visits, shows and the show rate", () => {
    expect(jace.visits).toBe(4);
    expect(jace.shows).toBe(3);
    expect(jace.showRate).toBeCloseTo(0.75);
  });

  it("counts proposals sent and how fast", () => {
    expect(jace.proposalsSent).toBe(3);
    expect(jace.medianHoursToProposal).toBe(1);
    expect(jace.withinSpeedTarget).toBeCloseTo(2 / 3);
  });

  it("works out close rate, ticket, revenue and commission", () => {
    expect(jace.closeRate).toBeCloseTo(2 / 3);
    expect(jace.averageTicket).toBe(5000);
    expect(jace.revenueSold).toBe(10000);
    expect(jace.commissionEarned).toBe(40);
    expect(jace.closeTone).toBe("good");
  });

  it("leaves out people with nothing in the window and sorts by money sold", () => {
    expect(rows.map((r) => r.name)).toEqual(["Jace", "Sam"]);
  });

  it("adds the team up", () => {
    const team = teamTotals(rows);
    expect(team.accepted).toBe(2);
    expect(team.declined).toBe(2);
    expect(team.closeRate).toBe(0.5);
    expect(team.closeTone).toBe("warn");
  });

  it("says nothing about close rate on too few decisions", () => {
    expect(closeRateTone(1, 2)).toBe("neutral");
    expect(closeRateTone(0.4, 10)).toBe("bad");
    expect(closeRateTone(0.45, 10)).toBe("warn");
    expect(closeRateTone(0.55, 10)).toBe("good");
  });
});

describe("sales KPIs", () => {
  const kpis = salesKpis({
    now,
    leads: [
      { createdAt: "2026-10-10T12:00:00.000Z", firstContactAt: "2026-10-10T12:02:00.000Z", booked: true },
      { createdAt: "2026-10-10T12:00:00.000Z", firstContactAt: "2026-10-10T12:30:00.000Z", booked: false },
      { createdAt: "2026-10-10T12:00:00.000Z", firstContactAt: null, booked: true },
      { createdAt: "2026-10-10T12:00:00.000Z", firstContactAt: "2026-10-10T12:10:00.000Z", booked: true },
    ],
    evaluations: [
      { date: "2026-10-05T12:00:00.000Z", status: "completed", submittedAt: "2026-10-05T13:00:00.000Z" },
      { date: "2026-10-06T12:00:00.000Z", status: "scheduled", submittedAt: null },
      { date: "2026-10-30T12:00:00.000Z", status: "scheduled", submittedAt: null },
    ],
    proposals: [
      { status: "accepted", total: 4000, sentAt: "x", expiresAt: null },
      { status: "declined", total: 1000, sentAt: "x", expiresAt: null },
      { status: "sent", total: 3000, sentAt: "2026-10-12T12:00:00.000Z", expiresAt: "2026-10-26T12:00:00.000Z" },
      { status: "sent", total: 9000, sentAt: "2026-09-01T12:00:00.000Z", expiresAt: "2026-09-15T12:00:00.000Z" },
      { status: "sent", total: 9000, sentAt: null, expiresAt: null },
    ],
  });

  it("works out each number", () => {
    expect(kpis.leadResponseMinutes).toBe(10);
    expect(kpis.bookedRate).toBe(0.75);
    expect(kpis.showRate).toBe(0.5);
    expect(kpis.closeRate).toBe(0.5);
    expect(kpis.averageTicket).toBe(4000);
    expect(kpis.pipelineValue).toBe(3000);
    expect(kpis.weightedPipeline).toBe(1500);
    expect(kpis.openProposals).toBe(1);
  });

  it("colours each against its band", () => {
    expect(toneFor(3, KPI_BANDS.leadResponseMinutes)).toBe("good");
    expect(toneFor(10, KPI_BANDS.leadResponseMinutes)).toBe("warn");
    expect(toneFor(30, KPI_BANDS.leadResponseMinutes)).toBe("bad");
    expect(toneFor(0.45, KPI_BANDS.closeRate)).toBe("warn");
    expect(toneFor(0.56, KPI_BANDS.closeRate)).toBe("good");
    expect(toneFor(null, KPI_BANDS.closeRate)).toBe("neutral");
  });
});
