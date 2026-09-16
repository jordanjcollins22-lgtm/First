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
