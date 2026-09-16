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
  /** The evaluator's note as it is on the design now. */
  note: string;
  current: ScopeRecommendation | null;
  history: ScopeRecommendation[];
  /** Whether an approved recommendation stands for the note as written now. */
  settled: boolean;
  /** The note changed since the last recommendation was written. */
  noteChanged: boolean;
}

export interface ZoneWithNote {
  zoneIndex: number;
  zoneName: string;
  note: string;
}

/** The latest round per zone, and whether the zone is settled. */
export function reviewsFor(zones: ZoneWithNote[], recs: ScopeRecommendation[]): ZoneReview[] {
  return zones
    .filter((z) => z.note.trim())
    .map((z) => {
      const rounds = recs.filter((r) => r.zoneIndex === z.zoneIndex).sort((a, b) => b.round - a.round);
      const current = rounds[0] ?? null;
      const noteChanged = current != null && current.evaluatorNote.trim() !== z.note.trim();
      return {
        zoneIndex: z.zoneIndex,
        zoneName: z.zoneName,
        note: z.note,
        current,
        history: rounds.slice(1),
        settled: current != null && current.status === "approved" && !noteChanged,
        noteChanged,
      };
    });
}

/** Zones that still need a recommendation written: none yet, or the note moved on. */
export function zonesNeedingDraft(reviews: ZoneReview[]): ZoneReview[] {
  return reviews.filter((r) => r.current == null || r.noteChanged || r.current.status === "declined");
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
