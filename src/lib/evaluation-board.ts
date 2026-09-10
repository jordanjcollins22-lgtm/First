/**
 * Every evaluation, before and after, and the ones somebody still owes.
 *
 * The selling screen only ever showed evaluations still marked "estimating",
 * which meant the moment one produced a proposal it vanished. Useful for a
 * to-do list and useless for the question actually being asked, which is: what
 * has this business got booked, what has it already done, and what did
 * somebody drive to a house for and never write up.
 *
 * That last one is the expensive category. An account manager measured a
 * garden, spent an hour there, and no proposal ever went out — the cost is
 * already sunk and the revenue never arrives. It is worth its own list, worth
 * being sorted oldest first, and worth being attached to a name, because "six
 * evaluations are unwritten" is a statistic and "Jace has four going back to
 * the 2nd" is something somebody does about it this afternoon.
 */

export type EvaluationState = "needs-submitting" | "upcoming" | "submitted" | "cancelled";

export const STATE_LABEL: Record<EvaluationState, string> = {
  "needs-submitting": "Needs submitting",
  upcoming: "Coming up",
  submitted: "Submitted",
  cancelled: "Cancelled",
};

export const STATE_BLURB: Record<EvaluationState, string> = {
  "needs-submitting":
    "Somebody has been to the property, or was due to be, and no proposal has gone out.",
  upcoming: "Booked, and still to happen.",
  submitted: "Written up, with a proposal out.",
  cancelled: "Called off.",
};

export interface BoardEvaluation {
  jobId: string;
  jobNumber: number | null;
  customerName: string | null;
  address: string | null;
  /** When the appointment is, or was. Null when it is booked but undated. */
  at: string | null;
  /** The evaluator's progress: scheduled, on_way, arrived, completed, cancelled. */
  evaluationStatus: string;
  /** The job's own status: estimating, quoted, approved, cancelled... */
  jobStatus: string;
  /** Whose it is. The account manager or evaluator it was assigned to. */
  assignedToId: string | null;
  assignedToName: string | null;
  /** Whether a proposal has actually been generated from it. */
  hasProposal: boolean;
  /**
   * Whether whoever it is on can actually be sent to a property.
   *
   * Null when nobody is assigned. False is the interesting one: an evaluation
   * sitting on a crew member is not late, it is lost, and it will stay lost
   * because the person holding it was never going to write it up.
   */
  assigneeDoesEvaluations: boolean | null;
}

/**
 * Where one evaluation sits.
 *
 * Written up is decided by whether a proposal exists rather than by the status
 * flag alone. The flag says somebody pressed a button; the proposal is the
 * thing the client receives, and an evaluation marked complete with no
 * proposal behind it is exactly the case this list exists to catch.
 */
export function stateOf(evaluation: BoardEvaluation, now: string): EvaluationState {
  if (evaluation.evaluationStatus === "cancelled" || evaluation.jobStatus === "cancelled") {
    return "cancelled";
  }

  if (evaluation.hasProposal) return "submitted";

  // Past the sale with no proposal row is odd, but it means somebody has moved
  // the job on and this list has nothing left to ask of it.
  if (evaluation.jobStatus !== "estimating") return "submitted";

  // Been there, or on the way there, and nothing written.
  if (evaluation.evaluationStatus !== "scheduled") return "needs-submitting";

  // Booked with no date is still booked. It is somebody's to schedule, not
  // somebody's to write up, and putting it in the owed pile would bury the
  // ones that genuinely are.
  if (!evaluation.at) return "upcoming";

  return evaluation.at < now ? "needs-submitting" : "upcoming";
}

/** How long it has been owed. Null for anything not owed, or with no date. */
export function daysWaiting(evaluation: BoardEvaluation, now: string): number | null {
  if (stateOf(evaluation, now) !== "needs-submitting") return null;
  if (!evaluation.at) return null;
  const then = Date.parse(evaluation.at);
  const today = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(today) || then > today) return null;
  return Math.floor((today - then) / 86_400_000);
}

/**
 * The evaluations in one state, in the order somebody would work them.
 *
 * Owed ones oldest first, because the one that has been waiting longest is
 * both the most likely to be forgotten and the least likely to still close.
 * Everything else newest or soonest first, which is how a list of what is
 * coming up and what just happened reads.
 */
export function inState(
  evaluations: readonly BoardEvaluation[],
  state: EvaluationState,
  now: string
): BoardEvaluation[] {
  const rows = evaluations.filter((evaluation) => stateOf(evaluation, now) === state);

  if (state === "needs-submitting") {
    // Undated ones last: they are owed, but there is no clock on them.
    return rows.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
  }
  if (state === "upcoming") {
    return rows.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
  }
  return rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export function stateCounts(
  evaluations: readonly BoardEvaluation[],
  now: string
): Record<EvaluationState, number> {
  const counts: Record<EvaluationState, number> = {
    "needs-submitting": 0,
    upcoming: 0,
    submitted: 0,
    cancelled: 0,
  };
  for (const evaluation of evaluations) counts[stateOf(evaluation, now)] += 1;
  return counts;
}

/**
 * Evaluations parked on somebody who does not do them.
 *
 * A different problem from a late one and it needs saying differently. A late
 * write-up is somebody being busy; this is an evaluation that will never be
 * written, because the person holding it does not visit properties and nobody
 * told them otherwise. It sits there ageing quietly in the owed pile,
 * indistinguishable from real work, which is how one of them reached a month.
 *
 * Only ever reported where somebody is assigned and we know they do not do
 * them. An unassigned evaluation is its own problem and already has its own
 * pile.
 */
export function misassigned(
  evaluations: readonly BoardEvaluation[],
  now: string
): BoardEvaluation[] {
  return evaluations
    .filter((evaluation) => {
      const state = stateOf(evaluation, now);
      if (state !== "needs-submitting" && state !== "upcoming") return false;
      return evaluation.assignedToId != null && evaluation.assigneeDoesEvaluations === false;
    })
    .sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
}

export interface OwnerPile {
  assignedToId: string | null;
  name: string;
  owed: number;
  /** The oldest one they owe, in days. Null when none of theirs is dated. */
  oldestDays: number | null;
  upcoming: number;
  /** Whether this person does evaluations at all. */
  doesEvaluations: boolean | null;
}

/**
 * What each account manager owes, and what they have coming.
 *
 * The whole reason the owed list is grouped rather than just counted. "Six
 * evaluations are unwritten" is a statistic; "Jace has four, the oldest from
 * the 2nd" is something somebody acts on before lunch.
 *
 * Anything assigned to nobody is its own pile rather than dropped, because an
 * unassigned evaluation nobody owes is the one that never gets written at all.
 */
export function byOwner(evaluations: readonly BoardEvaluation[], now: string): OwnerPile[] {
  const piles = new Map<string, OwnerPile>();

  for (const evaluation of evaluations) {
    const state = stateOf(evaluation, now);
    if (state !== "needs-submitting" && state !== "upcoming") continue;

    const key = evaluation.assignedToId ?? "";
    const pile = piles.get(key) ?? {
      assignedToId: evaluation.assignedToId,
      name: evaluation.assignedToName?.trim() || "Nobody assigned",
      owed: 0,
      oldestDays: null,
      upcoming: 0,
      doesEvaluations: evaluation.assignedToId == null ? null : evaluation.assigneeDoesEvaluations,
    };

    if (state === "upcoming") {
      pile.upcoming += 1;
    } else {
      pile.owed += 1;
      const days = daysWaiting(evaluation, now);
      if (days != null && (pile.oldestDays == null || days > pile.oldestDays)) {
        pile.oldestDays = days;
      }
    }

    piles.set(key, pile);
  }

  return Array.from(piles.values()).sort(
    (a, b) => b.owed - a.owed || (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || a.name.localeCompare(b.name)
  );
}
