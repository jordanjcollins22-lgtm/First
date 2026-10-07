import { GROSS_PROFIT_TARGET } from "@/lib/gross-profit";
import type { JobEstimate } from "@/lib/job-estimate";

/**
 * The project review: every job scored on six things, each of them good or
 * bad, green or red, and kept up to date as the job runs.
 *
 * - Issues: any at all is red. Each one has to be put right and has to say
 *   what changes so it cannot happen again.
 * - Hours: the hours the crew clocked on it against the hours it was priced
 *   on. Over is red.
 * - Cost: what it cost -- those hours at the crew rate, the materials, and
 *   anything bought on the day -- against what it was priced on. Over is red.
 * - A five-star review, yes or no.
 * - A referral: somebody they sent to us, yes or no.
 * - Profit: what is left of the price after that cost and the account
 *   manager's or affiliate's share. Under 50% is red.
 *
 * Pure, so the scoring is tested without a database.
 */

export interface ReviewIssue {
  id: string;
  /** An office issue, or a ticket from the crew. */
  kind: "issue" | "ticket";
  title: string;
  open: boolean;
  resolution: string | null;
  prevention: string | null;
  createdAt: string;
}

export interface ProjectReviewInput {
  /** What the client agreed to, after any discount, in cents. */
  priceCents: number;
  /** What it was priced on: crew-hours and cost (labour and materials), in cents. Null when nothing was priced. */
  budget: { crewHours: number; labourCents: number; materialsCents: number } | null;
  /** Hours clocked on the job, by everybody. */
  realCrewHours: number;
  crewRateCents: number;
  /** Anything bought for it on the day, from the receipts. */
  receiptsCents: number;
  /**
   * What the job really cost, entered by the account manager at the final
   * sign-off. When it is in, the review is scored on it rather than on the
   * clock and the receipts.
   */
  final?: { crewHours: number; materialsCents: number; otherCents: number } | null;
  feePct: number;
  issues: ReviewIssue[];
  /** Did they leave a five-star review: marked by hand, or found among the reviews pulled in. */
  fiveStar: { value: boolean | null; how: "marked" | "found" | null; note: string | null };
  /** The clients they sent to us. */
  referred: string[];
}

export interface Score {
  good: boolean;
  /** What goes in the square: "2", "12/10", "Y". */
  value: string;
  /** A line under it, in words. */
  detail: string;
  /** Budget and real, for a square that compares them: shown one over the other. */
  pair?: { budget: string; real: string };
}

export interface ProjectReview {
  issues: Score & { open: number; unprevented: number };
  hours: Score & { budget: number | null; real: number };
  cost: Score & { budgetCents: number | null; realCents: number };
  review: Score;
  referral: Score;
  profit: Score & { pct: number; profitCents: number };
  /** Every square green. */
  allGood: boolean;
}

const hrs = (h: number) => (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : h.toFixed(1));
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function scoreProject(input: ProjectReviewInput): ProjectReview {
  const open = input.issues.filter((i) => i.open).length;
  const unprevented = input.issues.filter((i) => !i.open && !i.prevention?.trim()).length;
  const issues = {
    good: input.issues.length === 0,
    value: String(input.issues.length),
    detail:
      input.issues.length === 0
        ? "None"
        : [open > 0 ? `${open} still open` : null, unprevented > 0 ? `${unprevented} with nothing to stop it happening again` : null]
            .filter(Boolean)
            .join(", ") || "All put right, and changed so they can't happen again",
    open,
    unprevented,
  };

  const budgetHours = input.budget?.crewHours ?? null;
  const real = Math.round((input.final?.crewHours ?? input.realCrewHours) * 10) / 10;
  const hours = {
    good: budgetHours != null && real <= budgetHours + 0.05,
    value: `${budgetHours == null ? "?" : hrs(budgetHours)}/${hrs(real)}`,
    detail:
      budgetHours == null
        ? "Nothing was priced, so there is no budget"
        : real <= budgetHours + 0.05
          ? `${hrs(budgetHours - real)} hrs under`
          : `${hrs(real - budgetHours)} hrs over`,
    pair: { budget: budgetHours == null ? "?" : hrs(budgetHours), real: hrs(real) },
    budget: budgetHours,
    real,
  };

  // The real cost: the hours clocked at the crew rate, the materials as they
  // were priced (they are bought to the list), and whatever was bought on
  // the day on top.
  const materialsCents = input.final?.materialsCents ?? input.budget?.materialsCents ?? 0;
  const otherCents = input.final?.otherCents ?? input.receiptsCents;
  const realCents = Math.round(real * input.crewRateCents) + materialsCents + otherCents;
  const budgetCents = input.budget ? input.budget.labourCents + input.budget.materialsCents : null;
  const cost = {
    good: budgetCents != null && realCents <= budgetCents,
    value: `${budgetCents == null ? "?" : dollars(budgetCents)}/${dollars(realCents)}`,
    detail:
      budgetCents == null
        ? "Nothing was priced, so there is no budget"
        : realCents <= budgetCents
          ? `${dollars(budgetCents - realCents)} under`
          : `${dollars(realCents - budgetCents)} over`,
    pair: { budget: budgetCents == null ? "?" : dollars(budgetCents), real: dollars(realCents) },
    budgetCents,
    realCents,
  };

  const review = {
    good: input.fiveStar.value === true,
    value: input.fiveStar.value === true ? "Y" : "N",
    detail: input.fiveStar.note ?? (input.fiveStar.value === false ? "No review" : "Not yet"),
  };

  const referral = {
    good: input.referred.length > 0,
    value: input.referred.length > 0 ? "Y" : "N",
    detail: input.referred.length > 0 ? input.referred.join(", ") : "Not yet",
  };

  const feeCents = Math.round((input.priceCents * Math.max(0, input.feePct)) / 100);
  const profitCents = input.priceCents - realCents - feeCents;
  const pct = input.priceCents > 0 ? profitCents / input.priceCents : 0;
  const profit = {
    good: input.priceCents > 0 && pct >= GROSS_PROFIT_TARGET - 0.0005,
    value: `${Math.round(pct * 100)}%`,
    detail: `${dollars(profitCents)} after costs and the ${input.feePct}% fee`,
    pct,
    profitCents,
  };

  return {
    issues,
    hours,
    cost,
    review,
    referral,
    profit,
    allGood: [issues, hours, cost, review, referral, profit].every((s) => s.good),
  };
}

/**
 * What the job was priced on, from the estimate kept with its proposal:
 * crew-hours on the clock (whole hours, travel in) and what they and the
 * materials cost, salting visits included. Null for an estimate from before
 * hours were charged whole, which the caller works out afresh.
 */
export function budgetFromEstimate(estimate: JobEstimate | null | undefined): ProjectReviewInput["budget"] {
  if (!estimate || estimate.billedHours == null) return null;
  const salting = estimate.salting ?? [];
  const saltHours = salting.reduce((sum, s) => sum + s.billedHours * s.treatments, 0);
  const saltLabour = salting.reduce((sum, s) => sum + s.labourCents * s.treatments, 0);
  const saltMaterials = salting.reduce((sum, s) => sum + s.materialCents * s.treatments, 0);
  const work = estimate.zones.length > 0;
  return {
    crewHours: (work ? estimate.billedHours * estimate.crew : 0) + saltHours,
    labourCents:
      (work ? estimate.costs.onSiteLabourCents + estimate.costs.travelLabourCents + (estimate.costs.roundingLabourCents ?? 0) : 0) + saltLabour,
    materialsCents: (work ? estimate.costs.materialsCents : 0) + saltMaterials,
  };
}
