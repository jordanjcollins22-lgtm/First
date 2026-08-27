/**
 * What a client actually wants to ask, and the answer they get.
 *
 * A blank "Questions?" box gets one of two things: silence, or an email three
 * days later. Both are the same outcome — the proposal stalls where nobody
 * can see it stalling. So the box is not blank. It is the objections this
 * business already hears, each with the answer it already gives, and where
 * that answer is a thing we can do rather than a thing we can say, the button
 * does it.
 *
 * "Something else" is deliberately hard to reach. It appears only once the
 * offered answers have been read and rejected — because an objection routed
 * to free text is an objection nobody has handled yet, and the whole point is
 * that most of them are already solved.
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
  /** What the client taps. Their words, not ours. */
  label: string;
  /** The objection handling. This is the answer to the question. */
  answer: string;
  /** What we can offer to do about it, best first. */
  resolutions: ResolutionKind[];
}

/**
 * The catalogue.
 *
 * Ordered by how often it comes up, because the first two buttons are the
 * ones that get pressed. Written in the voice of somebody answering the
 * phone, not a terms page — a client reading a stiff paragraph hears a
 * brush-off and goes quiet.
 */
export const OBJECTIONS: Objection[] = [
  {
    id: "price_high",
    label: "The price is more than I expected",
    answer:
      "That's fair, and worth talking about rather than guessing at. The number covers the crew, the materials, the haul-away and the insurance — there's nothing added at the end. If it's more than you want to spend right now, we have two honest ways round it: spread the cost over a few payments, or trim the work back to the parts that matter most to you. Either one keeps the quality the same; it's the scale or the timing that changes.",
    resolutions: ["payment_plan", "reduce_scope", "talk"],
  },
  {
    id: "cannot_pay_at_once",
    label: "I can't pay it all at once",
    answer:
      "You don't have to. We can take a deposit to get you on the schedule and split the rest over monthly payments — you'll see the exact amounts before you agree to anything, and there's no interest on it. Most people pick three or four payments.",
    resolutions: ["payment_plan", "talk"],
  },
  {
    id: "only_want_part",
    label: "I only want part of this",
    answer:
      "That's completely normal, and often the smart way to do it — get the part that's bothering you sorted now and leave the rest for later. Pick what you'd like to keep below and the price updates as you go. Anything you drop stays on file, so we can quote it again whenever you're ready.",
    resolutions: ["reduce_scope", "talk"],
  },
  {
    id: "not_sure_included",
    label: "I'm not sure what's included",
    answer:
      "Everything we'll do is written out on this page, area by area, with the photos we took on the day. The price covers labour, materials, and clearing up after ourselves — you won't get a bill for a dump run or an extra bag of mulch. If any line reads vaguely to you, that's our fault and we'd rather fix the wording than have you sign something you're unsure about.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "getting_other_quotes",
    label: "I'm getting other quotes",
    answer:
      "You should — it's your money and a good contractor won't mind. Two things worth checking on the others: whether they're licensed and insured in Maryland, and whether their number includes hauling the waste away, because that's the one that usually turns up later as an extra. Ours does. If somebody comes in lower, tell us what's on their sheet and we'll tell you straight whether we can match it or why we can't.",
    resolutions: ["explain", "talk"],
  },
  {
    id: "timing",
    label: "The timing doesn't work for me",
    answer:
      "We can work around you. If you need it sooner, tell us the date you're aiming at and we'll say honestly whether we can hit it rather than promise and slip. If you'd rather wait — for a season, a budget, or anything else — accepting now holds this price, and we'll book the dates when you're ready.",
    resolutions: ["talk", "payment_plan"],
  },
  {
    id: "havent_used_you",
    label: "I haven't worked with you before",
    answer:
      "Understood — you're letting strangers onto your property. We're local to Harford County, licensed and insured, and we'll send you the certificate if you want to see it. Every job gets before-and-after photos, and you get a walkthrough with us at the end before anybody asks you for the final payment. If something isn't right, you tell us at that walkthrough and we come back.",
    resolutions: ["explain", "talk"],
  },
];

export function objectionById(id: string): Objection | undefined {
  return OBJECTIONS.find((o) => o.id === id);
}

/**
 * Whether to offer "Something else".
 *
 * Only once an answer has been read and rejected. Offered up front it becomes
 * the path of least resistance and every objection arrives as free text,
 * which is exactly the pile this catalogue exists to empty.
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
