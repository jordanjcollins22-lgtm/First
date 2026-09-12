/**
 * Taking a bad import back out.
 *
 * Re-importing a corrected list does not fix a wrong one. Prospects are
 * matched on their address, so a file with corrected addresses has different
 * keys: the good rows arrive as new rows and the wrong ones stay exactly
 * where they were, and now the list is twice as long and half of it is
 * rubbish.
 *
 * Every import is stamped with the batch it came from, so the fix is to take
 * the bad batch out and import the corrected file. What this works out is
 * which rows can safely go.
 *
 * The rule: a row that represents work or a decision is never deleted. If
 * somebody has rung them, marked them do-not-contact, or turned them into a
 * customer, that is not import data any more, it is history, and an import
 * cleanup that quietly destroys history is worse than the bad addresses.
 */

export interface BatchRow {
  id: string;
  /** The batch name given at import. Null for rows from before batches. */
  batch: string | null;
  status: string;
  doNotContact: boolean;
  /** Whether anybody has actually reached out to them. */
  touched: boolean;
}

export interface BatchSummary {
  name: string;
  total: number;
  /** Ids that can go: untouched, undecided, nobody's history. */
  removable: string[];
  /** How many are staying, and why somebody should not be surprised. */
  keeping: number;
  keepingReason: string | null;
}

/** Rows nobody has done anything with yet. */
export function isRemovable(row: BatchRow): boolean {
  if (row.doNotContact) return false;
  if (row.touched) return false;
  return row.status === "new" || row.status === "queued";
}

/** Why a row is being kept, for the line under the button. */
function keepingReasonFor(kept: BatchRow[]): string | null {
  if (kept.length === 0) return null;

  const reasons: string[] = [];
  if (kept.some((r) => r.status === "converted")) reasons.push("became customers");
  if (kept.some((r) => r.touched || r.status === "contacted")) reasons.push("have been contacted");
  if (kept.some((r) => r.doNotContact)) reasons.push("asked not to be contacted");
  if (kept.some((r) => r.status === "rejected")) reasons.push("were ruled out already");

  if (reasons.length === 0) return "have history worth keeping";
  if (reasons.length === 1) return reasons[0];
  return `${reasons.slice(0, -1).join(", ")} or ${reasons[reasons.length - 1]}`;
}

/** Untitled imports still need a name to appear under. */
export const UNNAMED_BATCH = "Unnamed import";

export function summariseBatches(rows: BatchRow[]): BatchSummary[] {
  const byName = new Map<string, BatchRow[]>();
  for (const row of rows) {
    const name = row.batch?.trim() || UNNAMED_BATCH;
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }

  const summaries: BatchSummary[] = [];
  for (const [name, group] of byName) {
    const removable = group.filter(isRemovable);
    const kept = group.filter((r) => !isRemovable(r));
    summaries.push({
      name,
      total: group.length,
      removable: removable.map((r) => r.id),
      keeping: kept.length,
      keepingReason: keepingReasonFor(kept),
    });
  }

  // Biggest first: the one somebody wants to undo is nearly always the one
  // they just loaded three thousand rows from.
  return summaries.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The line on the button, so nobody presses it not knowing the count. */
export function removeLabel(batch: BatchSummary): string {
  if (batch.removable.length === 0) return "Nothing here can be removed";
  if (batch.removable.length === batch.total) {
    return `Remove all ${batch.total}`;
  }
  return `Remove ${batch.removable.length} of ${batch.total}`;
}
