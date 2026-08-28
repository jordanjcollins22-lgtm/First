/**
 * Working a list of local businesses for flyer spots.
 *
 * Selling seven tiles means ringing far more than seven businesses, and the
 * thing that decides whether that works is not effort but memory: who has
 * been called, how many times, and what they actually said. Without it the
 * same shop gets rung three times in a fortnight and the one who said "call
 * me in March" never gets called at all.
 *
 * Every touch is its own row, never a counter. A counter answers "did we do
 * the work"; only the rows answer "what happened", and that is the question
 * that decides where the next hour goes.
 */

/** The outreach channel these touches belong to. */
export const FLYER_CHANNEL_KEY = "flyer_ads";
export const FLYER_CHANNEL_NAME = "Flyer advertising";

/** The replies worth recording, coldest first. */
export type FlyerOutcome =
  | "attempted"
  | "reached"
  | "interested"
  | "booked"
  | "not_interested"
  | "do_not_contact";

export const OUTCOMES: { value: FlyerOutcome; label: string; blurb: string }[] = [
  { value: "attempted", label: "No answer", blurb: "Tried them, nobody picked up." },
  { value: "reached", label: "Spoke to them", blurb: "Got hold of somebody, no decision yet." },
  { value: "interested", label: "Interested", blurb: "Wants it, or wants to think about it." },
  { value: "booked", label: "Bought a spot", blurb: "Sold. They are on the run." },
  { value: "not_interested", label: "Not interested", blurb: "A no for now, worth asking again later." },
  { value: "do_not_contact", label: "Do not contact", blurb: "Asked us not to call again. Final." },
];

const LABELS = new Map(OUTCOMES.map((o) => [o.value, o.label]));

export function outcomeLabel(value: string): string {
  return LABELS.get(value as FlyerOutcome) ?? "Contacted";
}

/** A no that means never, as against a no that means not this run. */
export function isFinal(outcome: string | null): boolean {
  return outcome === "do_not_contact" || outcome === "booked";
}

export interface Touch {
  outcome: string;
  note: string | null;
  at: string;
}

export interface OutreachSummary {
  /** How many times we have reached out. */
  count: number;
  lastAt: string | null;
  lastOutcome: string | null;
  lastNote: string | null;
}

export function summariseOutreach(touches: Touch[]): OutreachSummary {
  if (touches.length === 0) {
    return { count: 0, lastAt: null, lastOutcome: null, lastNote: null };
  }

  // Sorted here rather than trusted from the caller: two screens reading the
  // same rows in different orders would disagree about what somebody said.
  const sorted = [...touches].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const last = sorted[0];

  return {
    count: touches.length,
    lastAt: last.at,
    lastOutcome: last.outcome,
    // The most recent note there is, not just the last touch's: "call me in
    // March" said two calls ago is still the useful thing on the row.
    lastNote: sorted.find((t) => t.note?.trim())?.note?.trim() ?? null,
  };
}

/** "3 days ago", "yesterday". */
export function since(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * The one line on the row.
 *
 * Count and outcome and when, together. Any one of them alone misleads: "3
 * times" could all have been last March, and "interested" could have been a
 * year ago.
 */
export function outreachLabel(summary: OutreachSummary, now: Date): string {
  if (summary.count === 0) return "Not contacted yet";

  const times = summary.count === 1 ? "Once" : `${summary.count} times`;
  const outcome = summary.lastOutcome ? outcomeLabel(summary.lastOutcome).toLowerCase() : "contacted";
  const when = summary.lastAt ? since(summary.lastAt, now) : "";

  return when ? `${times}, ${outcome}, ${when}` : `${times}, ${outcome}`;
}

/**
 * Who to ring next.
 *
 * Nobody who has bought or asked us to stop. Then the ones never tried, then
 * whoever has waited longest. Sorting by "most promising" sounds better and
 * is how the bottom of a list never gets called.
 */
export function callOrder<T extends { summary: OutreachSummary }>(rows: T[]): T[] {
  return [...rows]
    .filter((row) => !isFinal(row.summary.lastOutcome))
    .sort((a, b) => {
      if (a.summary.count === 0 && b.summary.count !== 0) return -1;
      if (b.summary.count === 0 && a.summary.count !== 0) return 1;
      const aAt = a.summary.lastAt ?? "";
      const bAt = b.summary.lastAt ?? "";
      return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
    });
}

/** How the list is doing, for the line above it. */
export function outreachTotals(summaries: OutreachSummary[]): {
  businesses: number;
  contacted: number;
  interested: number;
  sold: number;
} {
  return {
    businesses: summaries.length,
    contacted: summaries.filter((s) => s.count > 0).length,
    interested: summaries.filter((s) => s.lastOutcome === "interested").length,
    sold: summaries.filter((s) => s.lastOutcome === "booked").length,
  };
}
