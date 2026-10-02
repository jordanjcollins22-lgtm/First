/**
 * Where a quick mow request sits, worked out from what is already true about
 * it, the way the main pipeline is: the order (paid or not, called or not),
 * its job's status, and whether a visit is on the calendar. Nothing here is
 * stored, so it cannot drift from the facts.
 *
 * Its own pipeline because it is its own funnel: no evaluation, no proposal.
 * Somebody sees a price, pays, gets a call, gets a day, gets mowed.
 */

export type QuickMowStage = "requested" | "to_call" | "to_schedule" | "scheduled" | "mowed" | "lost";

export const QUICK_MOW_STAGES: { key: QuickMowStage; label: string; blurb: string }[] = [
  { key: "requested", label: "Requested", blurb: "Gave their details and saw a price. Not paid yet: call them." },
  { key: "to_call", label: "Paid, call within 24 hrs", blurb: "Paid for the first mow. Promised a call within 24 hours." },
  { key: "to_schedule", label: "Called, to schedule", blurb: "Called. Put the mow on the calendar." },
  { key: "scheduled", label: "Scheduled", blurb: "A day is set." },
  { key: "mowed", label: "Mowed", blurb: "First mow done." },
  { key: "lost", label: "Lost", blurb: "Cancelled, or never went ahead." },
];

export interface QuickMowFacts {
  /** mow_orders.status */
  orderStatus: string;
  calledAt: string | null;
  /** jobs.status, when the request has a job. */
  jobStatus: string | null;
  /** Work sessions on the job that are not cancelled. */
  visits: { status: string }[];
}

export function quickMowStage(facts: QuickMowFacts): QuickMowStage {
  if (facts.orderStatus === "cancelled" || facts.jobStatus === "cancelled") return "lost";
  if (facts.jobStatus === "completed" || facts.visits.some((v) => v.status === "done")) return "mowed";
  if (facts.orderStatus !== "paid") return "requested";
  if (facts.visits.some((v) => v.status !== "cancelled")) return "scheduled";
  if (!facts.calledAt) return "to_call";
  return "to_schedule";
}
