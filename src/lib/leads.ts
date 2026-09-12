/**
 * Finding the next $5k+ landscaping job in Harford County.
 *
 * This works from what the business already knows — every property it has
 * visited, quoted, or worked on, plus the lot size the property lookup returns
 * — rather than a bought list. Everything here is a real record somebody in
 * the business already touched; nothing is invented.
 *
 * The two questions it answers:
 *   1. Which of these is worth $5k or more?
 *   2. Which is worth chasing this week, and why?
 */

/** The ticket the business is aiming at. */
export const TARGET_TICKET = 5000;

export type LeadReason =
  | "quote_pending"
  | "quote_declined"
  | "evaluated_no_quote"
  | "past_client"
  | "unworked_property";

export const REASON_LABELS: Record<LeadReason, string> = {
  quote_pending: "Quoted, no answer yet",
  quote_declined: "Declined — worth a second run",
  evaluated_no_quote: "Visited but never priced",
  past_client: "Past client, due a check-in",
  unworked_property: "On the books, never sold anything",
};

/**
 * How much a job at this property is likely to be worth.
 *
 * Calibrated from the business's own closed work rather than an industry rule
 * of thumb — the same half-acre is worth different money in different markets,
 * and the only market that matters here is the one already being served.
 */
export interface TicketCalibration {
  /** Dollars per acre, from realised proposal totals. */
  perAcre: number;
  /** What a job is worth before any lot size is considered. */
  base: number;
  /** How many closed jobs this was derived from. Low means treat it loosely. */
  sampleSize: number;
}

// Used until there's enough of the business's own history to beat it. Stated
// as an assumption rather than a fact, and the screen says so.
export const DEFAULT_CALIBRATION: TicketCalibration = {
  perAcre: 6000,
  base: 1500,
  sampleSize: 0,
};

/** Fewer than this and the average is noise, so the default stands. */
const MIN_SAMPLE = 5;

export interface ClosedJobSample {
  acreage: number | null;
  total: number;
}

/**
 * Derives dollars-per-acre from jobs that actually closed.
 *
 * Deliberately conservative: it only uses jobs with both a lot size and a
 * total, and falls back to the documented default rather than extrapolating
 * from two data points.
 */
export function calibrateFromHistory(samples: ClosedJobSample[]): TicketCalibration {
  const usable = samples.filter(
    (s) => s.acreage != null && s.acreage > 0 && s.total > 0
  ) as { acreage: number; total: number }[];

  if (usable.length < MIN_SAMPLE) return DEFAULT_CALIBRATION;

  const perAcreValues = usable.map((s) => s.total / s.acreage).sort((a, b) => a - b);
  // Median, not mean — one estate job shouldn't drag the whole model up.
  const median = perAcreValues[Math.floor(perAcreValues.length / 2)];

  const averageTotal = usable.reduce((sum, s) => sum + s.total, 0) / usable.length;
  const averageAcreage = usable.reduce((sum, s) => sum + s.acreage, 0) / usable.length;

  return {
    perAcre: Math.round(median),
    // Whatever the average job is worth beyond what lot size explains.
    base: Math.max(0, Math.round(averageTotal - median * averageAcreage)),
    sampleSize: usable.length,
  };
}

export function estimateTicket(
  acreage: number | null,
  calibration: TicketCalibration
): number | null {
  if (acreage == null || acreage <= 0) return null;
  return Math.round(calibration.base + calibration.perAcre * acreage);
}

export interface LeadInput {
  jobStatus: string;
  proposalStatus: string | null;
  proposalTotal: number | null;
  evaluationStatus: string | null;
  evaluationDate: string | null;
  /** Most recent thing that happened, for working out how cold it's gone. */
  lastActivity: string | null;
  acreage: number | null;
}

export interface LeadAssessment {
  reason: LeadReason | null;
  /** Known proposal total when there is one, otherwise the estimate. */
  ticket: number | null;
  ticketIsEstimate: boolean;
  qualifies: boolean;
  /** 0–100, only meaningful for ranking against the other leads. */
  score: number;
  why: string[];
}

function daysSince(date: string | null, today: Date): number | null {
  if (!date) return null;
  const then = new Date(date.length > 10 ? date : `${date}T12:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((today.getTime() - then.getTime()) / 86_400_000);
}

/** Base weight per reason — how much a lead of this kind is usually worth
 * chasing, before size and recency adjust it. */
const REASON_WEIGHT: Record<LeadReason, number> = {
  quote_pending: 45,
  evaluated_no_quote: 40,
  quote_declined: 25,
  past_client: 30,
  unworked_property: 15,
};

export function assessLead(input: LeadInput, calibration: TicketCalibration, today = new Date()): LeadAssessment {
  const why: string[] = [];

  // Live work isn't a lead — it's a job.
  if (input.jobStatus === "in_progress" || input.jobStatus === "approved") {
    return { reason: null, ticket: null, ticketIsEstimate: false, qualifies: false, score: 0, why: [] };
  }

  let reason: LeadReason;
  if (input.proposalStatus === "sent") {
    reason = "quote_pending";
  } else if (input.proposalStatus === "declined") {
    reason = "quote_declined";
  } else if (input.jobStatus === "completed") {
    reason = "past_client";
  } else if (input.evaluationStatus === "completed" && !input.proposalStatus) {
    reason = "evaluated_no_quote";
  } else {
    reason = "unworked_property";
  }

  const known = input.proposalTotal != null && input.proposalTotal > 0;
  const ticket = known ? input.proposalTotal : estimateTicket(input.acreage, calibration);
  const ticketIsEstimate = !known && ticket != null;

  if (known) why.push(`Quoted at $${input.proposalTotal!.toLocaleString()}`);
  else if (ticket != null) why.push(`${input.acreage} acre lot suggests roughly $${ticket.toLocaleString()}`);

  let score = REASON_WEIGHT[reason];

  // Size against the target the business is aiming at.
  if (ticket != null) {
    if (ticket >= TARGET_TICKET * 2) {
      score += 30;
      why.push("Well above the $5k target");
    } else if (ticket >= TARGET_TICKET) {
      score += 20;
      why.push("Above the $5k target");
    } else {
      score -= 15;
      why.push("Below the $5k target");
    }
  }

  // Recency cuts both ways: a quote from last week is warm, a past client from
  // last week has just been done and doesn't need calling.
  const age = daysSince(input.lastActivity, today);
  if (age != null) {
    if (reason === "past_client") {
      if (age >= 300) {
        score += 20;
        why.push("Roughly a year since the last job");
      } else if (age < 90) {
        score -= 25;
        why.push("Worked recently — leave it a while");
      }
    } else if (age <= 30) {
      score += 15;
      why.push("Still warm");
    } else if (age > 180) {
      score -= 15;
      why.push("Gone cold");
    }
  }

  return {
    reason,
    ticket,
    ticketIsEstimate,
    qualifies: ticket != null && ticket >= TARGET_TICKET,
    score: Math.max(0, Math.min(100, Math.round(score))),
    why,
  };
}
