/**
 * Five numbers, one sentence, one button.
 *
 * The business already has an analytics screen -- signals, levers, a ramp
 * plan, a forecast, a to-do list -- and it is good, and it is not this. This is
 * the screen an owner opens on a Sunday night to answer one question: is the
 * business getting better, and if not, what is the one thing in the way.
 *
 * So the discipline here is subtraction. Exactly five numbers, chosen because
 * each one moves for a different reason and losing any one of them would hide
 * something. Exactly one bottleneck, because a list of four things to fix is a
 * list nobody starts. Exactly one button, because the gap between knowing the
 * problem and being on the screen that fixes it is where the evening goes.
 *
 * Two rules about honesty, which matter more here than anywhere else in the
 * app, because these are the numbers somebody is going to steer by.
 *
 * **Nothing is invented.** A number that is not known reads as not known.
 * Owner hours nobody logged are "not logged", never zero -- a fabricated zero
 * would make the graph go the right way for the wrong reason, which is the
 * worst outcome available for this particular measurement.
 *
 * **The bottleneck is chosen by rule, in a fixed order, and the order is
 * written down.** No weighting, no score, no model. Somebody has to be able to
 * disagree with it, and they cannot disagree with something they cannot see.
 */

export type KpiTone = "good" | "watch" | "bad" | "unknown";

export interface Kpi {
  key: "cash" | "profit" | "evaluations" | "booked" | "owner-hours";
  label: string;
  /** Already formatted. "$12,400", "3.2 wks", "Not logged". */
  value: string;
  /** The line under it: what it is measured against, or why it is not known. */
  says: string;
  tone: KpiTone;
}

export interface GrowthInput {
  /** Cash on hand today, or null when nothing says. */
  cash: number | null;
  /** The line the business must not go under. */
  cashFloor: number;
  /** Money in and out over the window, from what actually moved. */
  moneyIn: number;
  moneyOut: number;
  /** How many weeks the in/out figures cover. */
  windowWeeks: number;
  /** Evaluations booked per week lately, and the number wanted. */
  evaluationsPerWeek: number;
  evaluationsTargetPerWeek: number;
  /** Sold work ahead, in weeks of the crew's actual output. */
  weeksBooked: number;
  weeksBookedTarget: number;
  /** Hours the owner logged last week, or null when they logged nothing. */
  ownerHoursLastWeek: number | null;
  ownerHoursTarget: number;
  /** Decisions in the last week that only somebody owner-level could make. */
  ownerTouchesLastWeek: number;
  /** Where those hours went, when enough was logged to say. */
  ownerTopCategory: string | null;
  /** Right now, from the field. */
  crewsStopped: number;
  changesAwaitingReview: number;
}

function money(amount: number): string {
  return Math.round(amount).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function ratioTone(actual: number, target: number): KpiTone {
  if (target <= 0) return "unknown";
  const ratio = actual / target;
  return ratio >= 1 ? "good" : ratio >= 0.6 ? "watch" : "bad";
}

export const CATEGORY_LABEL: Record<string, string> = {
  rescheduling: "moving work around",
  client_escalation: "clients who escalated",
  pricing_decision: "pricing decisions",
  field_decision: "decisions the field could not make",
  chasing_payment: "chasing payment",
  quality_rework: "putting work right",
  hiring_training: "hiring and training",
  admin: "admin",
  other: "other things",
};

/**
 * Profit as the money that actually moved, not as an accounting position.
 *
 * Cash in minus cash out over the window. It is deliberately the cruder of the
 * two available measures: it is the one an owner can check against their bank,
 * and a profit figure somebody cannot check is a profit figure they will
 * quietly stop believing.
 */
export function cashProfit(input: Pick<GrowthInput, "moneyIn" | "moneyOut">): number {
  return input.moneyIn - input.moneyOut;
}

/** Evaluations a week still needed to hit the target. Never negative. */
export function evaluationsShort(input: Pick<GrowthInput, "evaluationsPerWeek" | "evaluationsTargetPerWeek">): number {
  return Math.max(0, input.evaluationsTargetPerWeek - input.evaluationsPerWeek);
}

/**
 * The five, in a fixed order, always five.
 *
 * Cash, then profit, then the two numbers that say whether work is coming, then
 * how much of it still runs through one person.
 */
export function growthKpis(input: GrowthInput): Kpi[] {
  const profit = cashProfit(input);
  const short = evaluationsShort(input);
  const weeks = Math.max(1, input.windowWeeks);

  const cash: Kpi =
    input.cash == null
      ? {
          key: "cash",
          label: "Cash",
          value: "Not known",
          says: "No bank linked and no figure entered.",
          tone: "unknown",
        }
      : {
          key: "cash",
          label: "Cash",
          value: money(input.cash),
          says:
            input.cash >= input.cashFloor
              ? `${money(input.cash - input.cashFloor)} above your floor of ${money(input.cashFloor)}.`
              : `${money(input.cashFloor - input.cash)} below your floor of ${money(input.cashFloor)}.`,
          tone: input.cash >= input.cashFloor ? "good" : input.cash >= input.cashFloor * 0.6 ? "watch" : "bad",
        };

  const profitKpi: Kpi = {
    key: "profit",
    label: "Profit",
    value: money(profit),
    says: `${money(input.moneyIn)} in, ${money(input.moneyOut)} out, last ${weeks} weeks. ${money(profit / weeks)} a week.`,
    tone: profit > 0 ? "good" : profit === 0 ? "watch" : "bad",
  };

  const evaluations: Kpi = {
    key: "evaluations",
    label: "Evaluations needed",
    value: short === 0 ? "None" : `${short.toFixed(1)} / wk`,
    says:
      short === 0
        ? `${input.evaluationsPerWeek.toFixed(1)} a week against ${input.evaluationsTargetPerWeek} wanted. Enough.`
        : `${input.evaluationsPerWeek.toFixed(1)} a week against ${input.evaluationsTargetPerWeek} wanted.`,
    tone: ratioTone(input.evaluationsPerWeek, input.evaluationsTargetPerWeek),
  };

  const booked: Kpi = {
    key: "booked",
    label: "Weeks booked",
    value: `${input.weeksBooked.toFixed(1)} wks`,
    says: `Against ${input.weeksBookedTarget} wanted. This is sold work, measured in weeks of what the crew actually gets through.`,
    tone: ratioTone(input.weeksBooked, input.weeksBookedTarget),
  };

  // The only one allowed to say "not known", and it says it rather than
  // reading as a very good zero.
  const ownerHours: Kpi =
    input.ownerHoursLastWeek == null
      ? {
          key: "owner-hours",
          label: "Your hours in the work",
          value: "Not logged",
          says:
            input.ownerTouchesLastWeek > 0
              ? `${input.ownerTouchesLastWeek} decision${input.ownerTouchesLastWeek === 1 ? "" : "s"} last week that only you could make. Log the time to see the hours.`
              : "Nothing logged, and no decisions came to you last week.",
          tone: "unknown",
        }
      : {
          key: "owner-hours",
          label: "Your hours in the work",
          value: `${input.ownerHoursLastWeek.toFixed(1)} h`,
          says:
            (input.ownerHoursLastWeek <= input.ownerHoursTarget
              ? `Against ${input.ownerHoursTarget} you wanted. `
              : `${(input.ownerHoursLastWeek - input.ownerHoursTarget).toFixed(1)} over the ${input.ownerHoursTarget} you wanted. `) +
            (input.ownerTopCategory
              ? `Mostly ${CATEGORY_LABEL[input.ownerTopCategory] ?? input.ownerTopCategory}.`
              : `${input.ownerTouchesLastWeek} decision${input.ownerTouchesLastWeek === 1 ? "" : "s"} came to you.`),
          tone:
            input.ownerHoursLastWeek <= input.ownerHoursTarget
              ? "good"
              : input.ownerHoursLastWeek <= input.ownerHoursTarget * 1.5
                ? "watch"
                : "bad",
        };

  return [cash, profitKpi, evaluations, booked, ownerHours];
}

export interface Bottleneck {
  /** A stable name for the rule that fired, so it can be tested and talked about. */
  key:
    | "cash-below-floor"
    | "crew-stopped"
    | "spending-more-than-earning"
    | "not-enough-booked"
    | "not-enough-evaluations"
    | "owner-is-the-bottleneck"
    | "decisions-queueing"
    | "none";
  /** One sentence. Not a paragraph, not a list. */
  says: string;
  /** The one place to go. Null only when there is nothing to fix. */
  fix: { label: string; href: string } | null;
}

/**
 * The one thing in the way, chosen by rule, in this order.
 *
 * The order is an argument, and it is meant to be arguable:
 *
 * 1. Cash under the floor ends the business. Nothing outranks it.
 * 2. A crew standing in a garden is costing money by the minute and is
 *    usually fixable in five.
 * 3. Spending more than you earn over a season is the slow version of (1).
 * 4. Not enough sold work is next, because it is the thing with the longest
 *    lead time -- by the time it hurts, fixing it takes two months.
 * 5. Not enough evaluations is (4) one step earlier in the chain.
 * 6. The owner being the switchboard is last of the real problems, because a
 *    business that is otherwise healthy can survive it -- but it is the one
 *    that stops the business ever growing past the owner.
 *
 * Exactly one fires. If several are true, the highest one is the answer, and
 * the others will still be there next week.
 */
export function bottleneck(input: GrowthInput): Bottleneck {
  if (input.cash != null && input.cash < input.cashFloor) {
    return {
      key: "cash-below-floor",
      says: `Cash is the constraint: ${money(input.cash)} against a floor of ${money(input.cashFloor)}.`,
      fix: { label: "See what is owed", href: "/more?tab=finance" },
    };
  }

  if (input.crewsStopped > 0) {
    return {
      key: "crew-stopped",
      says:
        input.crewsStopped === 1
          ? "A crew is stopped on site and waiting on a decision."
          : `${input.crewsStopped} crews are stopped on site and waiting on a decision.`,
      fix: { label: "Deal with it", href: "/jobs?tab=attention" },
    };
  }

  const profit = cashProfit(input);
  if (profit < 0) {
    return {
      key: "spending-more-than-earning",
      says: `You are spending more than you are taking in: ${money(-profit)} down over ${Math.max(1, input.windowWeeks)} weeks.`,
      fix: { label: "Look at the money", href: "/more?tab=finance" },
    };
  }

  if (input.weeksBookedTarget > 0 && input.weeksBooked < input.weeksBookedTarget * 0.6) {
    return {
      key: "not-enough-booked",
      says: `Not enough sold work: ${input.weeksBooked.toFixed(1)} weeks booked against ${input.weeksBookedTarget} you wanted.`,
      fix: { label: "Get more out there", href: "/marketing?tab=leads" },
    };
  }

  const short = evaluationsShort(input);
  if (short > 0 && input.evaluationsTargetPerWeek > 0 && input.evaluationsPerWeek < input.evaluationsTargetPerWeek * 0.8) {
    return {
      key: "not-enough-evaluations",
      says: `You need ${short.toFixed(1)} more evaluations a week to keep the crew fed.`,
      fix: { label: "Work the map", href: "/marketing?tab=map" },
    };
  }

  if (input.ownerHoursLastWeek != null && input.ownerHoursLastWeek > input.ownerHoursTarget) {
    const over = input.ownerHoursLastWeek - input.ownerHoursTarget;
    const where = input.ownerTopCategory ? CATEGORY_LABEL[input.ownerTopCategory] ?? input.ownerTopCategory : null;
    return {
      key: "owner-is-the-bottleneck",
      says: where
        ? `You are the constraint: ${over.toFixed(1)} hours over what you wanted, mostly ${where}.`
        : `You are the constraint: ${over.toFixed(1)} hours over what you wanted last week.`,
      fix: { label: "See what came to you", href: "/jobs?tab=attention" },
    };
  }

  if (input.changesAwaitingReview > 0) {
    return {
      key: "decisions-queueing",
      says:
        input.changesAwaitingReview === 1
          ? "A change request is sitting unanswered, and the crew cannot do the work until it is."
          : `${input.changesAwaitingReview} change requests are sitting unanswered.`,
      fix: { label: "Clear them", href: "/jobs?tab=attention" },
    };
  }

  return {
    key: "none",
    says: "Nothing is holding the business back this week. Keep it boring.",
    fix: null,
  };
}
