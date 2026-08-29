/**
 * What a client actually wants to ask, and the answer they get.
 *
 * A blank "Questions?" box gets one of two things: silence, or an email three
 * days later. Both are the same outcome: the proposal stalls where nobody can
 * see it stalling. So the box is not blank. It is the questions this business
 * already fields, each with the answer it already gives, and where that answer
 * is something we can do rather than something we can say, the button does it.
 *
 * Every label is phrased as the client's own question and never as the worry
 * behind it. "How did you come up with this price?" and "the price is too
 * high" send a reader to the same paragraph, but only one of them makes them
 * feel read back to. Nothing on this screen should look like a sales script
 * anticipating them, and the word "objection" must never reach it.
 *
 * "Ask something else" is deliberately hard to reach. It appears only once the
 * offered answers have been read and rejected, because a question routed to
 * free text is one nobody has answered yet, and the whole point is that most
 * of them already have an answer.
 */

/** What a button can actually do, beyond saying words. */
export type ResolutionKind =
  /** The answer is the answer. Nothing to action. */
  | "explain"
  /** Offer to spread it: deposit now, the rest over instalments. */
  | "payment_plan"
  /** Let them drop parts of the work and see the price move. */
  | "reduce_scope"
  /** Book a time to talk it through. */
  | "talk";

export interface Objection {
  id: string;
  /**
   * What the client taps, phrased as their question rather than as the worry
   * behind it. Their words, not a salesperson's summary of them.
   */
  label: string;
  /** The answer. Written the way somebody answering the phone would say it. */
  answer: string;
  /** What we can offer to do about it, best first. */
  resolutions: ResolutionKind[];
}

/**
 * The catalogue.
 *
 * Ordered by how often it comes up, because the first two buttons are the
 * ones that get pressed. Written in the voice of somebody answering the
 * phone rather than a terms page: a client reading a stiff paragraph hears a
 * brush-off and goes quiet.
 */
export const OBJECTIONS: Objection[] = [
  {
    id: "price_high",
    label: "How did you come up with this price?",
    answer:
      "Fair question, and worth asking. The number covers the crew's time, the materials, hauling the waste away and the insurance, so there is nothing added at the end. If it is more than you had in mind right now, we have two honest ways around it: spread it over a few payments, or trim the work back to the parts that matter most to you. Either way the quality stays the same. It is the scale or the timing that changes.",
    resolutions: ["payment_plan", "reduce_scope", "talk"],
  },
  {
    id: "cannot_pay_at_once",
    label: "Can I split this into payments?",
    answer:
      "Yes. We can take a deposit to get you on the schedule and split the rest across monthly payments. You will see the exact amounts and dates before you agree to anything, and there is no interest on it. Most people pick three or four payments.",
    resolutions: ["payment_plan", "talk"],
  },
  {
    id: "only_want_part",
    label: "Can I just do part of it for now?",
    answer:
      "Of course, and it is often the smart way to do it. Get the part that is bothering you sorted now and leave the rest for later. Pick what you would like to keep below and the price updates as you go. Anything you leave off stays on file, so we can quote it again whenever you are ready.",
    resolutions: ["reduce_scope", "talk"],
  },
  {
    id: "not_sure_included",
    label: "What exactly is included?",
    answer:
      "Everything we will do is written out on this page, area by area, with the photos we took on the day. The price covers labor, materials, and clearing up after ourselves, so you will not get a bill for a dump run or an extra bag of mulch. If any line reads vaguely to you, that is on us, and we would rather fix the wording than have you sign something you are unsure about.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "timing",
    label: "When could you start?",
    answer:
      "Tell us the date you are aiming at and we will say honestly whether we can hit it, rather than promise it and slip. Bear in mind we work outdoors, so heavy rain or frozen ground can move a day. If that happens we tell you as soon as we know and you keep your place at the front of the schedule. If you would rather wait for a season or a budget, accepting now holds this price and we book the dates when you are ready.",
    resolutions: ["talk", "payment_plan"],
  },
  {
    id: "weather_delay",
    label: "What happens if the weather is bad?",
    answer:
      "We move you, and we tell you before you are standing at the window wondering. Heavy rain and frozen ground make some of this work either unsafe or bad for the lawn, so we would rather come back on a good day than do a poor job on a wet one. You keep your place at the front of the schedule, and you are not charged anything for a day that got moved.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "getting_other_quotes",
    label: "How do you compare with other quotes?",
    answer:
      "You should get other quotes. It is your money and a good contractor will not mind. Two things worth checking on the others: whether they are licensed and insured in Maryland, and whether their price includes hauling the waste away, because that is the one that usually shows up later as an extra. Our price already includes it. If somebody comes in lower, tell us what is on their sheet and we will tell you straight whether we can match it or why we cannot.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "havent_used_you",
    label: "Are you licensed and insured?",
    answer:
      "Yes to both, and we will send you the certificate if you would like to see it. We are local to Harford County. If part of your plan is something we do not do in house, we hire a licensed and insured partner for that part rather than attempting it ourselves, and we check their paperwork before they set foot on your property. Every job gets before and after photos, and you get a walkthrough with us at the end before anybody asks you for the final payment.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "not_happy",
    label: "What if I am not happy with something?",
    answer:
      "You tell us at the walkthrough and we come back. That walkthrough happens before we ask for the final payment, on purpose, so you are never in the position of having paid for something you are not happy with. If you spot something after we have gone, call us and we will come and look at it.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "who_comes",
    // The only answer built per proposal rather than written here. Some work
    // goes to a partner business, so a fixed paragraph would be true of most
    // jobs and a lie about the rest. See lib/who-attends; this text is the
    // fallback for a proposal with nothing priced on it yet.
    label: "Who will be at my property?",
    answer:
      "Our own crew, in company shirts and a marked truck. You will know the day before who is coming and roughly what time. Anything in your plan that is not something we do in house, we do not have a go at. We hire a licensed and insured partner who does that work every day, and we stay responsible for it either way. If you would like to be home for it we will work around that, and if you would rather not be, that is fine too. We will send you photos when it is done.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "how_to_pay",
    label: "How do I pay?",
    answer:
      "Card, Apple Pay, Google Pay, check or bank transfer, whichever suits you. Accepting takes you straight to the payment screen, and once that is settled a team member reaches out to get your service booked in. If you would rather spread it out, you can pick that on the same screen.",
    resolutions: ["payment_plan", "explain"],
  },
  {
    id: "add_later",
    label: "Can I add something later?",
    answer:
      "Yes, though it becomes its own visit rather than getting added to this one. That is deliberate, so you always know exactly what you are paying for and our crew are never put on the spot to price something in your driveway. Call us and we will get you a number for it.",
    resolutions: ["explain", "talk"],
  },
];

export function objectionById(id: string): Objection | undefined {
  return OBJECTIONS.find((o) => o.id === id);
}

/**
 * Whether to offer "Ask something else".
 *
 * Only once an answer has been read and rejected. Offered up front it becomes
 * the path of least resistance and every question arrives as free text, which
 * is exactly the pile this catalogue exists to empty.
 */
export function shouldOfferOther(state: {
  /** Objection ids the client has opened and then said did not help. */
  rejected: string[];
}): boolean {
  return state.rejected.length > 0;
}

// ---------------------------------------------------------------------------
// Reducing the scope
// ---------------------------------------------------------------------------

/** One line of the proposal, as far as re-pricing is concerned. */
export interface ScopeLine {
  zoneName: string;
  serviceLabel: string;
  /** Who does this one: our own crew, or a partner business. */
  performedBy?: "own" | "partner";
  partnerName?: string | null;
  /** Cents, at the moment the proposal was generated. Null when we never
   * captured one — an older proposal, or a price nobody could derive. */
  priceCents: number | null;
  /**
   * Whether that price came from the rate card rather than somebody's head.
   *
   * A hand-entered price is not a bug, it is a judgement — a difficult access,
   * a favour, a number agreed on the phone. Which is exactly why removing a
   * neighbouring line cannot silently re-derive it.
   */
  priceDerived: boolean;
}

export interface ScopeChange {
  keptNames: string[];
  droppedNames: string[];
  /** The new total, in cents. Null when we cannot work one out. */
  newTotalCents: number | null;
  droppedCents: number;
  /** True when the new price can stand without anybody checking it. */
  auto: boolean;
  /** Why it needs a person, when it does. Shown to the client verbatim, so
   * it says what happens next rather than naming a column. */
  reviewReason: string | null;
}

export interface ReduceScopeOptions {
  /** A discount already applied to the whole proposal, in cents. */
  discountCents?: number;
  /** What the proposal says the total is, in cents. */
  statedTotalCents?: number | null;
}

/**
 * Work out the price of keeping only some of the work.
 *
 * Returns a change that either applies itself or goes to a person, and says
 * which. It never guesses a total: a proposal with a hand-entered line, an
 * agreed discount, or a line we have no price for comes back for review, and
 * the client is told so plainly rather than being shown a number that later
 * moves.
 */
export function reduceScope(
  lines: ScopeLine[],
  keepNames: string[],
  options: ReduceScopeOptions = {}
): ScopeChange {
  const keep = new Set(keepNames);
  const kept = lines.filter((l) => keep.has(l.zoneName));
  const dropped = lines.filter((l) => !keep.has(l.zoneName));

  const base: ScopeChange = {
    keptNames: kept.map((l) => l.zoneName),
    droppedNames: dropped.map((l) => l.zoneName),
    newTotalCents: null,
    droppedCents: 0,
    auto: false,
    reviewReason: null,
  };

  if (kept.length === 0) {
    return {
      ...base,
      reviewReason: "Keep at least one area — if none of it works, decline instead and tell us why.",
    };
  }
  if (dropped.length === 0) {
    return { ...base, newTotalCents: options.statedTotalCents ?? null, auto: false };
  }

  const unpriced = lines.some((l) => l.priceCents == null);
  const handEntered = lines.some((l) => l.priceCents != null && !l.priceDerived);
  const discounted = (options.discountCents ?? 0) > 0;

  const keptCents = kept.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
  const droppedCents = dropped.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);

  // Every line has to be priced, or the parts do not add up to the whole and
  // the remainder is arithmetic on a number we do not have.
  if (unpriced) {
    return {
      ...base,
      droppedCents,
      reviewReason: "We'll confirm the new price by email — part of this quote was priced by hand.",
    };
  }
  if (handEntered) {
    return {
      ...base,
      droppedCents,
      reviewReason: "We'll confirm the new price by email — one of these areas was priced by hand.",
    };
  }
  if (discounted) {
    return {
      ...base,
      droppedCents,
      reviewReason: "We'll confirm the new price by email — this quote has a discount on it we'd need to re-apply.",
    };
  }

  return {
    ...base,
    newTotalCents: keptCents,
    droppedCents,
    auto: true,
    reviewReason: null,
  };
}

/**
 * Whether trimming the scope is worth offering at all.
 *
 * A single-area proposal has nothing to trim to, and offering the button
 * anyway leads to a screen whose only move is "keep everything".
 */
export function canReduceScope(lines: ScopeLine[]): boolean {
  return lines.length > 1;
}

/** The resolutions worth showing for this objection on this proposal. */
export function availableResolutions(objection: Objection, lines: ScopeLine[]): ResolutionKind[] {
  return objection.resolutions.filter((r) => r !== "reduce_scope" || canReduceScope(lines));
}
