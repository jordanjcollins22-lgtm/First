/**
 * Every property in the county, and whether anybody has spoken to it.
 *
 * The goal is a marker on all of them. Not because all of them are customers —
 * most of a county is small lots, rentals and people who do their own yard —
 * but because the person with the quarter-acre knows the neighbour with the
 * three acres, and asking them is free.
 *
 * So "not our market" is a reason to ask who they know, never a reason to skip
 * the door. That is why out-of-market is its own field rather than a status,
 * and why a referral is its own outcome: logged as "not interested", a call
 * that produced a name looks identical to one that produced nothing, and the
 * entire argument for working the rest of the county vanishes from the report.
 */

export type ContactState =
  | "uncontacted"
  | "attempted"
  | "spoken_to"
  | "interested"
  | "referral"
  | "client"
  | "closed";

export const STATE_ORDER: ContactState[] = [
  "uncontacted",
  "attempted",
  "spoken_to",
  "interested",
  "referral",
  "client",
  "closed",
];

export const STATE_LABELS: Record<ContactState, string> = {
  uncontacted: "Nobody has tried",
  attempted: "Tried, no answer",
  spoken_to: "Spoke to them",
  interested: "Interested",
  referral: "Gave us a name",
  client: "Already ours",
  closed: "Don't contact",
};

/**
 * Colours, chosen to be told apart as dots rather than to look pleasant in a
 * legend. Grey for untouched so the map reads as "how much is still grey",
 * which is the question somebody opens it with.
 */
export const STATE_COLORS: Record<ContactState, string> = {
  uncontacted: "#9ca3af",
  attempted: "#f59e0b",
  spoken_to: "#3b82f6",
  interested: "#8b5cf6",
  referral: "#ec4899",
  client: "#16a34a",
  closed: "#4b5563",
};

export interface ProspectContactInput {
  status: string;
  doNotContact: boolean;
  /** The most recent outreach outcome, if anybody has logged one. */
  lastOutcome: string | null;
  /** True when a touch on this property ever produced a name. */
  everReferred?: boolean;
}

/**
 * What colour this property is.
 *
 * Order matters and is not the order things happened in. Do-not-contact wins
 * over everything, because it is the one state that must never be overwritten
 * by a later, cheerier one. A referral outranks "not interested" for the same
 * reason the outcome exists at all: the call worked, it just did not work the
 * way a booking works.
 */
export function contactState(input: ProspectContactInput): ContactState {
  if (input.doNotContact || input.lastOutcome === "do_not_contact") return "closed";
  if (input.status === "converted") return "client";
  if (input.everReferred || input.lastOutcome === "referral_received") return "referral";

  switch (input.lastOutcome) {
    case "booked":
    case "interested":
      return "interested";
    case "reached":
      return "spoken_to";
    case "not_interested":
      // Spoken to, and the answer was no. Still worth a colour of its own from
      // "nobody has tried" — the difference decides whether to knock again.
      return "spoken_to";
    case "attempted":
      return "attempted";
  }

  // No touch logged. Fall back to whatever the prospect row says, so a list
  // imported as already-contacted is not drawn as virgin territory.
  if (input.status === "contacted") return "attempted";
  if (input.status === "rejected") return "closed";
  return "uncontacted";
}

export interface CoverageTally {
  state: ContactState;
  label: string;
  color: string;
  count: number;
}

export interface CoverageSummary {
  total: number;
  /** Anything that is not "nobody has tried". */
  touched: number;
  /** 0–1. The number the whole exercise is measured by. */
  fraction: number;
  /** Names gathered from people who were never going to buy. */
  referrals: number;
  tallies: CoverageTally[];
}

export function summariseCoverage(states: ContactState[]): CoverageSummary {
  const counts = new Map<ContactState, number>(STATE_ORDER.map((s) => [s, 0]));
  for (const state of states) {
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  const total = states.length;
  const untouched = counts.get("uncontacted") ?? 0;
  const touched = total - untouched;

  return {
    total,
    touched,
    fraction: total === 0 ? 0 : touched / total,
    referrals: counts.get("referral") ?? 0,
    // Every state, including the empty ones: a colour that vanishes from the
    // legend when nobody is in it makes the map unreadable the first time
    // somebody does land in it.
    tallies: STATE_ORDER.map((state) => ({
      state,
      label: STATE_LABELS[state],
      color: STATE_COLORS[state],
      count: counts.get(state) ?? 0,
    })),
  };
}

/**
 * The sentence under the coverage bar.
 *
 * A percentage on its own invites nobody to do anything. Saying how many doors
 * are left is a number somebody can divide by thirty calls a day.
 */
export function describeCoverage(summary: CoverageSummary): string {
  if (summary.total === 0) {
    return "No parcels imported yet. Import the county on the Leads page and every property gets a marker.";
  }
  const left = summary.total - summary.touched;
  const percent = Math.round(summary.fraction * 100);
  if (left === 0) return "Every property on file has been contacted at least once.";
  return `${percent}% contacted — ${left.toLocaleString()} ${left === 1 ? "property" : "properties"} nobody has tried yet.`;
}

/** Whether the map should draw individual properties or ask somebody to zoom
 * in. Drawing a county of dots at county zoom is a grey smear that answers
 * nothing and costs a phone its frame rate. */
export const MARKER_ZOOM_THRESHOLD = 11;
export const MARKER_LIMIT = 3000;
