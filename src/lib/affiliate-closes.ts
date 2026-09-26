/**
 * Who closed what: the affiliate leaderboard's rule.
 *
 * A sold job is credited to one person. Whoever's tracked link brought it
 * in, first: that is the affiliate who found the client. Then whoever the
 * job is assigned to, the person who went out and sold it. Then the client's
 * account manager. A sold job with none of the three is nobody's, and the
 * board says so rather than hiding it.
 *
 * Pure, so the rule is tested without a database.
 */

export interface SoldJobInput {
  id: string;
  status: string;
  declined: boolean;
  /** The accepted proposal's total, when there is one. */
  soldFor: number | null;
  proposalAccepted: boolean;
  referralCode: string | null;
  referredBy: string | null;
  assignedTo: string | null;
  accountManager: string | null;
  closedAt: string | null;
}

export function isSold(job: SoldJobInput): boolean {
  if (job.declined || job.status === "cancelled") return false;
  return job.status === "approved" || job.status === "in_progress" || job.status === "completed" || job.proposalAccepted;
}

export function creditFor(job: SoldJobInput, posterByCode: ReadonlyMap<string, string>): string | null {
  const poster = job.referralCode ? posterByCode.get(job.referralCode) : undefined;
  return poster ?? job.referredBy ?? job.assignedTo ?? job.accountManager ?? null;
}

export interface CloserStanding {
  profileId: string;
  name: string;
  /** Jobs sold. */
  closed: number;
  /** What they sold for. */
  closedValue: number;
  /** Sold in the last thirty days. */
  monthValue: number;
  /** Comments they posted from the board. */
  comments: number;
}

/** Everybody listed, sold or not, best first: money sold, then jobs, then comments. */
export function rankClosers(
  people: { id: string; name: string }[],
  jobs: SoldJobInput[],
  posterByCode: ReadonlyMap<string, string>,
  comments: ReadonlyMap<string, number>,
  now: Date
): { standings: CloserStanding[]; unclaimed: { closed: number; value: number } } {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const by = new Map<string, CloserStanding>(
    people.map((p) => [p.id, { profileId: p.id, name: p.name, closed: 0, closedValue: 0, monthValue: 0, comments: comments.get(p.id) ?? 0 }])
  );
  const unclaimed = { closed: 0, value: 0 };
  for (const job of jobs) {
    if (!isSold(job)) continue;
    const who = creditFor(job, posterByCode);
    const value = job.soldFor ?? 0;
    const row = who ? by.get(who) : undefined;
    if (!row) {
      unclaimed.closed += 1;
      unclaimed.value += value;
      continue;
    }
    row.closed += 1;
    row.closedValue += value;
    if (job.closedAt && job.closedAt >= monthAgo) row.monthValue += value;
  }
  const standings = [...by.values()].sort(
    (a, b) => b.closedValue - a.closedValue || b.closed - a.closed || b.comments - a.comments || a.name.localeCompare(b.name)
  );
  return { standings, unclaimed };
}
