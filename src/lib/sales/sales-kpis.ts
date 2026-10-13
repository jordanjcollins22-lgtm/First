/**
 * The sales numbers against the planning bands in the research report
 * ("Landscaping four department playbook", KPI targets table).
 *
 * Every band here is a planning band, not a standard: the report found no
 * independent landscaping funnel benchmark, and most of these come from
 * vendors or agencies. Each KPI says where its band came from, so the owner
 * can see which ones to trust and which to recalibrate once the business's
 * own data has a season in it.
 *
 * Pure, so the arithmetic is tested without a database.
 */

import { median } from "@/lib/sales/speed-to-proposal";
import { CLOSE_RATE_BAND, type Tone } from "@/lib/sales/scorecard";

export interface KpiBand {
  /** Good at or beyond this. */
  good: number;
  /** Bad beyond this; between the two is a warning. */
  bad: number;
  /** Which way is better. */
  better: "higher" | "lower";
  /** Where the band came from, for the tile's small print. */
  source: string;
}

export const KPI_BANDS = {
  leadResponseMinutes: { good: 5, bad: 15, better: "lower", source: "< 5 min, automated (old, non-industry research; directional). 15 min is the report's hot-lead exception." },
  bookedRate: { good: 0.7, bad: 0.5, better: "higher", source: "Lead → evaluation ≥ 70% (research synthesis)." },
  showRate: { good: 0.9, bad: 0.8, better: "higher", source: "Internal target: no published band was found." },
  closeRate: { good: CLOSE_RATE_BAND.high, bad: CLOSE_RATE_BAND.low, better: "higher", source: "45-55% of decided proposals (Level CFO 2026, labelled unverified). Now 45%." },
  sameDayProposal: { good: 0.9, bad: 0.6, better: "higher", source: "Evaluation → proposal sent same day ≥ 90% (vendor-attributed NALP claim, unverified)." },
  averageTicket: { good: 5000, bad: 3500, better: "higher", source: "Internal: the $5k ticket the lead engine aims at." },
} as const satisfies Record<string, KpiBand>;

export function toneFor(value: number | null, band: KpiBand): Tone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (band.better === "higher") return value >= band.good ? "good" : value >= band.bad ? "warn" : "bad";
  return value <= band.good ? "good" : value <= band.bad ? "warn" : "bad";
}

export interface LeadRow {
  /** When the lead came in: the client record was created. */
  createdAt: string;
  /** The first message that went to them, if any. */
  firstContactAt: string | null;
  /** They booked an evaluation. */
  booked: boolean;
}

export interface EvaluationRow {
  date: string;
  status: string | null;
  submittedAt: string | null;
}

export interface ProposalRow {
  status: string;
  /** After discount, in dollars. */
  total: number;
  sentAt: string | null;
  expiresAt: string | null;
}

export interface SalesKpis {
  leads: number;
  /** Median minutes from the lead coming in to the first message out. */
  leadResponseMinutes: number | null;
  bookedRate: number | null;
  showRate: number | null;
  closeRate: number | null;
  decided: number;
  averageTicket: number | null;
  /** Open, sent proposals that have not expired, in dollars. */
  pipelineValue: number;
  /** The same, weighted at the close rate: what it is likely worth. */
  weightedPipeline: number | null;
  openProposals: number;
}

export function salesKpis(input: { leads: LeadRow[]; evaluations: EvaluationRow[]; proposals: ProposalRow[]; now: Date }): SalesKpis {
  const now = input.now.getTime();
  const minutes = input.leads
    .map((l) => (l.firstContactAt ? (new Date(l.firstContactAt).getTime() - new Date(l.createdAt).getTime()) / 60_000 : null))
    .filter((m): m is number => m != null && m >= 0);
  const due = input.evaluations.filter((e) => e.status !== "cancelled" && new Date(e.date).getTime() <= now);
  const shows = due.filter((e) => e.status === "completed" || e.submittedAt != null);
  const accepted = input.proposals.filter((p) => p.status === "accepted");
  const declined = input.proposals.filter((p) => p.status === "declined");
  const decided = accepted.length + declined.length;
  const closeRate = decided ? accepted.length / decided : null;
  const open = input.proposals.filter((p) => p.status === "sent" && p.sentAt != null && (!p.expiresAt || new Date(p.expiresAt).getTime() > now));
  const pipelineValue = open.reduce((s, p) => s + Math.max(0, p.total), 0);
  return {
    leads: input.leads.length,
    leadResponseMinutes: median(minutes),
    bookedRate: input.leads.length ? input.leads.filter((l) => l.booked).length / input.leads.length : null,
    showRate: due.length ? shows.length / due.length : null,
    closeRate,
    decided,
    averageTicket: accepted.length ? accepted.reduce((s, p) => s + Math.max(0, p.total), 0) / accepted.length : null,
    pipelineValue,
    weightedPipeline: closeRate == null ? null : pipelineValue * closeRate,
    openProposals: open.length,
  };
}
