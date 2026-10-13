/**
 * The evaluator scorecard: one row per person who does evaluations, with the
 * numbers that say whether their visits turn into money.
 *
 * Close rate is the headline, because it is what the business is paid on.
 * The planning band is 45-55% of decided proposals (Level CFO's 2026 bands,
 * which Level itself labels unverified); the business sits at 45% today, at
 * the bottom of it, so the target is the top: 55%. The rest of the row is how
 * a person gets there or doesn't: visits, whether clients are home for them,
 * how many proposals go out and how fast, the size of the ticket, the money
 * sold and the commission it has earned them.
 *
 * Pure, so the arithmetic is tested without a database.
 */

import { median } from "@/lib/sales/speed-to-proposal";

export const CLOSE_RATE_BAND = { low: 0.45, high: 0.55, now: 0.45 } as const;

/** Fewer decided proposals than this and a close rate says more about luck than the person. */
export const MIN_DECIDED_FOR_RATE = 3;

export interface ScorecardJob {
  evaluatorId: string;
  evaluationDate: string | null;
  evaluationStatus: string | null;
  submittedAt: string | null;
  proposalStatus: string | null;
  sentAt: string | null;
  /** After any discount, in dollars. */
  proposalTotal: number | null;
  /** Money in on the job, in dollars. */
  collected: number;
}

export interface ScorecardRow {
  evaluatorId: string;
  name: string;
  /** Visits that were due by now, not cancelled. */
  visits: number;
  /** Visits that happened: submitted. */
  shows: number;
  showRate: number | null;
  proposalsSent: number;
  /** Median hours from submitted to sent. */
  medianHoursToProposal: number | null;
  /** Share of sent proposals inside the speed target. */
  withinSpeedTarget: number | null;
  accepted: number;
  declined: number;
  closeRate: number | null;
  /** Mean accepted proposal, in dollars. */
  averageTicket: number | null;
  /** Accepted proposals added up, in dollars. */
  revenueSold: number;
  /** Their share of what has been collected on what they sold, in dollars. */
  commissionEarned: number;
  /** Where close rate sits against the band. */
  closeTone: Tone;
}

export type Tone = "good" | "warn" | "bad" | "neutral";

/** Close rate against the band: at the top is good, inside is short of target, under is bad. */
export function closeRateTone(rate: number | null, decided: number): Tone {
  if (rate == null || decided < MIN_DECIDED_FOR_RATE) return "neutral";
  if (rate >= CLOSE_RATE_BAND.high) return "good";
  if (rate >= CLOSE_RATE_BAND.low) return "warn";
  return "bad";
}

const ACCEPTED = new Set(["accepted"]);
const DECLINED = new Set(["declined"]);

export function buildScorecard(
  people: { id: string; name: string }[],
  jobs: ScorecardJob[],
  options: { now: Date; since?: Date | null; speedTargetHours: number; commissionPct: number }
): ScorecardRow[] {
  const since = options.since?.getTime() ?? -Infinity;
  const now = options.now.getTime();
  return people
    .map((person) => {
      const mine = jobs.filter((j) => j.evaluatorId === person.id && j.evaluationDate && new Date(j.evaluationDate).getTime() >= since);
      const due = mine.filter((j) => j.evaluationStatus !== "cancelled" && new Date(j.evaluationDate!).getTime() <= now);
      const shows = due.filter((j) => j.evaluationStatus === "completed" || j.submittedAt != null);
      const sent = mine.filter((j) => j.sentAt != null || ACCEPTED.has(j.proposalStatus ?? "") || DECLINED.has(j.proposalStatus ?? ""));
      const hours = mine
        .map((j) => (j.submittedAt && j.sentAt ? (new Date(j.sentAt).getTime() - new Date(j.submittedAt).getTime()) / 3_600_000 : null))
        .filter((h): h is number => h != null && h >= 0);
      const accepted = mine.filter((j) => ACCEPTED.has(j.proposalStatus ?? ""));
      const declined = mine.filter((j) => DECLINED.has(j.proposalStatus ?? ""));
      const decided = accepted.length + declined.length;
      const closeRate = decided > 0 ? accepted.length / decided : null;
      const sold = accepted.reduce((s, j) => s + Math.max(0, j.proposalTotal ?? 0), 0);
      const collected = accepted.reduce((s, j) => s + Math.max(0, j.collected), 0);
      return {
        evaluatorId: person.id,
        name: person.name,
        visits: due.length,
        shows: shows.length,
        showRate: due.length ? shows.length / due.length : null,
        proposalsSent: sent.length,
        medianHoursToProposal: median(hours),
        withinSpeedTarget: hours.length ? hours.filter((h) => h <= options.speedTargetHours).length / hours.length : null,
        accepted: accepted.length,
        declined: declined.length,
        closeRate,
        averageTicket: accepted.length ? sold / accepted.length : null,
        revenueSold: round2(sold),
        commissionEarned: round2((collected * options.commissionPct) / 100),
        closeTone: closeRateTone(closeRate, decided),
      };
    })
    .filter((row) => row.visits > 0 || row.proposalsSent > 0)
    .sort((a, b) => b.revenueSold - a.revenueSold || (b.closeRate ?? -1) - (a.closeRate ?? -1));
}

/** The whole team as one row, for the line at the bottom. */
export function teamTotals(rows: ScorecardRow[]): Omit<ScorecardRow, "evaluatorId" | "name" | "medianHoursToProposal" | "withinSpeedTarget"> {
  const sum = (pick: (r: ScorecardRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const visits = sum((r) => r.visits);
  const shows = sum((r) => r.shows);
  const accepted = sum((r) => r.accepted);
  const declined = sum((r) => r.declined);
  const sold = sum((r) => r.revenueSold);
  const closeRate = accepted + declined > 0 ? accepted / (accepted + declined) : null;
  return {
    visits,
    shows,
    showRate: visits ? shows / visits : null,
    proposalsSent: sum((r) => r.proposalsSent),
    accepted,
    declined,
    closeRate,
    averageTicket: accepted ? sold / accepted : null,
    revenueSold: round2(sold),
    commissionEarned: round2(sum((r) => r.commissionEarned)),
    closeTone: closeRateTone(closeRate, accepted + declined),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
