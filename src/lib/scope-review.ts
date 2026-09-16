/**
 * Reviewing what we propose to say, against what the evaluator wrote.
 *
 * The evaluator's note is kept as written and never becomes the proposal.
 * What becomes the proposal is a recommendation written from the note,
 * once somebody in the office has approved it. A decline says why and gets
 * a fresh round; every round stays on the record, so the question "why
 * does the proposal say this" always has an answer.
 */

export type RecommendationStatus = "pending" | "approved" | "declined" | "superseded";

export interface ScopeRecommendation {
  id: string;
  jobId: string;
  zoneIndex: number;
  zoneName: string;
  round: number;
  evaluatorNote: string;
  /** The service the zone had when this was written. */
  serviceLabel: string | null;
  recommendedText: string;
  status: RecommendationStatus;
  declineReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** One zone's review: the current round, and every round before it. */
export interface ZoneReview {
  zoneIndex: number;
  zoneName: string;
  /** The evaluator's note as it is on the design now. Empty when they wrote none. */
  note: string;
  /** The service on the zone now. */
  serviceLabel: string;
  current: ScopeRecommendation | null;
  history: ScopeRecommendation[];
  /** Whether an approved recommendation stands for the zone as it is now. */
  settled: boolean;
  /** The zone moved on since the last round was written: a new note, or a new service. */
  changed: boolean;
  /** What moved, in words, or null. */
  changedWhy: string | null;
}

export interface ZoneWithNote {
  zoneIndex: number;
  zoneName: string;
  note: string;
  serviceLabel: string;
}

/**
 * The latest round per zone, and whether the zone is settled.
 *
 * Every zone with a service is reviewed, note or no note: a zone with no
 * note gets the service's standard wording as its recommendation, and the
 * office still says yes or no to it. A round written for a different note
 * or a different service than the zone has now is stale, whatever its
 * status, because the words were about something else.
 */
export function reviewsFor(zones: ZoneWithNote[], recs: ScopeRecommendation[]): ZoneReview[] {
  return zones.map((z) => {
    const rounds = recs
      .filter((r) => r.zoneIndex === z.zoneIndex || (r.zoneIndex !== z.zoneIndex && r.zoneName === z.zoneName && !zones.some((o) => o.zoneIndex === r.zoneIndex)))
      .sort((a, b) => b.round - a.round);
    const current = rounds[0] ?? null;
    const noteMoved = current != null && current.evaluatorNote.trim() !== z.note.trim();
    const serviceMoved = current != null && current.serviceLabel != null && current.serviceLabel !== z.serviceLabel;
    const changed = noteMoved || serviceMoved;
    const changedWhy = serviceMoved
      ? `the service changed to ${z.serviceLabel}`
      : noteMoved
        ? "the evaluator's note changed"
        : null;
    return {
      zoneIndex: z.zoneIndex,
      zoneName: z.zoneName,
      note: z.note,
      serviceLabel: z.serviceLabel,
      current,
      history: rounds.slice(1),
      settled: current != null && current.status === "approved" && !changed,
      changed,
      changedWhy,
    };
  });
}

/** Zones that still need a recommendation written: none yet, the zone moved on, or the last was declined. */
export function zonesNeedingDraft(reviews: ZoneReview[]): ZoneReview[] {
  return reviews.filter((r) => r.current == null || r.changed || r.current.status === "declined" || r.current.status === "superseded");
}

/** What is stopping the proposal being approved, in words, or null. */
export function reviewBlocker(reviews: ZoneReview[]): string | null {
  const open = reviews.filter((r) => !r.settled);
  if (open.length === 0) return null;
  const names = open.map((r) => r.zoneName);
  return `Approve or decline the recommended scope for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`} first.`;
}

/** The next round number for a zone. */
export function nextRound(recs: ScopeRecommendation[], zoneIndex: number): number {
  return recs.filter((r) => r.zoneIndex === zoneIndex).reduce((max, r) => Math.max(max, r.round), 0) + 1;
}

/**
 * When the reason for declining is the wording itself.
 *
 * "This is how I would like it to be written: ..." is not feedback for a
 * rewrite, it is the rewrite. The office outranks the model, so the words
 * after the cue go on as the next round exactly as typed, and the model is
 * not asked. A reason with no cue but written as a full scope, several
 * sentences of the work itself, is treated the same way.
 */
const DICTATION_CUE =
  /^\s*(?:(?:this|here) is (?:how|what) (?:i(?:'d| would)? (?:like|want) it|it should)(?: to)?(?: be)?(?: written| read| say)?|(?:please )?(?:write|word|say|use|make) (?:it|this)(?: like this| exactly| as follows)?|it should (?:read|say)|use (?:this|the following)(?: wording| instead)?|exact wording|wording)\s*[:,\-]?\s*/i;

export function dictatedWording(reason: string): string | null {
  const text = reason.trim();
  if (!text) return null;
  const cued = DICTATION_CUE.exec(text);
  if (cued) {
    const rest = text.slice(cued[0].length).trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();
    return rest.length >= 12 ? rest : null;
  }
  // No cue, but this reads as the scope itself rather than a note about it:
  // more than one sentence and long enough to be the thing, not a remark.
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  const words = text.split(/\s+/).length;
  const complaint = /^(?:too|not|don'?t|doesn'?t|needs?|should(?:n'?t)?|remove|drop|mention|add|less|more|shorter|longer|wrong)\b/i.test(text);
  if (sentences.length >= 2 && words >= 20 && !complaint) return text;
  return null;
}

/** The house style on wording somebody typed: dashes only, nothing else touched. */
export function keepWordingAsTyped(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013\u2015]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Zones judged together.
 *
 * Six lawn areas with the same service and the same words are one decision,
 * not six. Zones are grouped when their current recommendation is the same
 * service and the same wording; a zone with its own note usually has its
 * own wording and stands alone. A group is approved as one; any zone in it
 * can be declined on its own, which breaks it out with its own round.
 */
export interface ReviewGroup {
  key: string;
  serviceLabel: string;
  /** The wording every zone in the group shares. Null while one is being written. */
  text: string | null;
  zones: ZoneReview[];
  /** Every zone in the group has an approved round for what it is now. */
  settled: boolean;
  /** Something in the group still needs a yes or no. */
  open: boolean;
}

export function groupReviews(reviews: ZoneReview[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const review of reviews) {
    const text = review.current && !review.changed ? review.current.recommendedText.trim() : null;
    // Only a pending or approved wording groups; a zone with nothing written
    // yet, or a declined one waiting for its next round, stands alone.
    const groupable = text != null && review.current != null && (review.current.status === "pending" || review.current.status === "approved");
    const key = groupable ? `${review.serviceLabel}\u0000${text}` : `zone:${review.zoneIndex}`;
    const group = groups.get(key) ?? { key, serviceLabel: review.serviceLabel, text: groupable ? text : null, zones: [], settled: true, open: false };
    group.zones.push(review);
    group.settled = group.settled && review.settled;
    group.open = group.open || !review.settled;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.zones[0].zoneIndex - b.zones[0].zoneIndex);
}

/** The group to show next: the first that still needs a decision. */
export function nextOpenGroup(groups: ReviewGroup[]): ReviewGroup | null {
  return groups.find((g) => g.open) ?? null;
}

/** "Zone 3" or "Zones 8, 9 and 10". */
export function zoneListLabel(zones: { zoneName: string }[]): string {
  const names = zones.map((z) => z.zoneName);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
