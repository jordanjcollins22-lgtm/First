/**
 * Why the owner said no, in one tap.
 *
 * 51 of 132 held emails were declined and nothing recorded why, so the same
 * trigger kept writing the same email for the owner to decline again. A
 * reason per "no", counted by kind, is what turns a pile of declines into
 * the one trigger worth fixing.
 *
 * Pure: no reads, no writes.
 */

export const DECLINE_REASONS = ["wrong_person", "cancelled_booking", "wording", "timing", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export function isDeclineReason(value: string): value is DeclineReason {
  return (DECLINE_REASONS as readonly string[]).includes(value);
}

export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  wrong_person: "Wrong person or duplicate",
  cancelled_booking: "Cancelled booking",
  wording: "Wording",
  timing: "Timing",
  other: "Other",
};

/** What each reason usually means needs fixing, for the report. */
export const DECLINE_REASON_FIX: Record<DeclineReason, string> = {
  wrong_person: "A trigger is firing for a duplicate booking or the wrong contact.",
  cancelled_booking: "A trigger is not checking for a cancelled booking.",
  wording: "The template needs rewriting.",
  timing: "The email fires at the wrong moment, or after a person already handled it.",
  other: "Read the notes.",
};

export interface DeclineRow {
  reason: string;
  itemType: string;
  itemKind: string | null;
}

export interface ReasonCount {
  reason: DeclineReason;
  count: number;
  /** The kinds behind this reason, most declined first. */
  kinds: { kind: string; count: number }[];
}

/**
 * The top reasons, most common first, each with the kinds behind it.
 * Unknown reasons are counted as other rather than lost.
 */
export function topDeclineReasons(rows: readonly DeclineRow[], limit = 5): ReasonCount[] {
  const byReason = new Map<DeclineReason, Map<string, number>>();
  for (const row of rows) {
    const reason: DeclineReason = isDeclineReason(row.reason) ? row.reason : "other";
    const kinds = byReason.get(reason) ?? new Map<string, number>();
    const kind = row.itemKind || row.itemType;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    byReason.set(reason, kinds);
  }
  return [...byReason.entries()]
    .map(([reason, kinds]) => ({
      reason,
      count: [...kinds.values()].reduce((a, b) => a + b, 0),
      kinds: [...kinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    }))
    .sort((a, b) => b.count - a.count || DECLINE_REASONS.indexOf(a.reason) - DECLINE_REASONS.indexOf(b.reason))
    .slice(0, limit);
}

/** "12 of 30 declined (40%)", or null when nothing was decided. */
export function declineRateLine(declined: number, decided: number): string | null {
  if (decided <= 0) return null;
  return `${declined} of ${decided} declined (${Math.round((declined / decided) * 100)}%)`;
}
