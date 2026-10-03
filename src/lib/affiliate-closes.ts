/**
 * Who closed what: the affiliate leaderboard's rule.
 *
 * Only what came from an affiliate link counts. A job is credited to the
 * affiliate whose tracked link the client booked through, or whose own
 * booking link they used; a job that came in any other way is not on this
 * board at all, however it was sold. And only people who have put links out
 * are on it.
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

/** The affiliate whose link brought this job in, or null when no link did. */
export function creditFor(job: SoldJobInput, posterByCode: ReadonlyMap<string, string>): string | null {
  const poster = job.referralCode ? posterByCode.get(job.referralCode) : undefined;
  return poster ?? job.referredBy ?? null;
}

export interface CloserStanding {
  profileId: string;
  name: string;
  /** Links they have put out. */
  links: number;
  /** Jobs booked through their links, sold or not yet. */
  booked: number;
  /** Jobs sold. */
  closed: number;
  /** What they sold for. */
  closedValue: number;
  /** Sold in the last thirty days. */
  monthValue: number;
  /** Comments they posted from the board. */
  comments: number;
}

/**
 * Everybody who has put a link out, best first: money closed, then jobs
 * closed, then booked, then links out. Nobody else is listed.
 */
export function rankClosers(
  people: { id: string; name: string }[],
  jobs: SoldJobInput[],
  posterByCode: ReadonlyMap<string, string>,
  linksOut: ReadonlyMap<string, number>,
  comments: ReadonlyMap<string, number>,
  now: Date
): CloserStanding[] {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const by = new Map<string, CloserStanding>();
  // Somebody whose own booking link a client used has put a link out too,
  // even with no tracked links on the board.
  const brought = new Set(jobs.map((j) => creditFor(j, posterByCode)).filter((id): id is string => Boolean(id)));
  for (const p of people) {
    const links = linksOut.get(p.id) ?? 0;
    if (links === 0 && !brought.has(p.id)) continue;
    by.set(p.id, { profileId: p.id, name: p.name, links, booked: 0, closed: 0, closedValue: 0, monthValue: 0, comments: comments.get(p.id) ?? 0 });
  }
  for (const job of jobs) {
    const who = creditFor(job, posterByCode);
    const row = who ? by.get(who) : undefined;
    if (!row || job.declined || job.status === "cancelled") continue;
    row.booked += 1;
    if (!isSold(job)) continue;
    const value = job.soldFor ?? 0;
    row.closed += 1;
    row.closedValue += value;
    if (job.closedAt && job.closedAt >= monthAgo) row.monthValue += value;
  }
  return [...by.values()].sort(
    (a, b) => b.closedValue - a.closedValue || b.closed - a.closed || b.booked - a.booked || b.links - a.links || a.name.localeCompare(b.name)
  );
}

/**
 * Where one answered post has got to, for the person who answered it.
 *
 * waiting: nobody has clicked the link. clicked: somebody has, but not
 * booked. evaluation: they booked, and the proposal is not in front of them
 * yet. proposal: it is. closed: they bought. said_no: they turned it down,
 * or the job was called off.
 */
export type PostStage = "waiting" | "clicked" | "evaluation" | "proposal" | "closed" | "said_no";

export const POST_STAGES: { key: PostStage; label: string }[] = [
  { key: "waiting", label: "No clicks yet" },
  { key: "clicked", label: "Clicked" },
  { key: "evaluation", label: "Evaluation booked" },
  { key: "proposal", label: "Proposal sent" },
  { key: "closed", label: "Closed" },
  { key: "said_no", label: "Said no" },
];

export function stageOf(job: (SoldJobInput & { proposalStatus: string | null }) | null, clicks: number): PostStage {
  if (!job) return clicks > 0 ? "clicked" : "waiting";
  if (job.declined || job.status === "cancelled" || job.proposalStatus === "declined") return "said_no";
  if (isSold(job)) return "closed";
  if (job.proposalStatus === "sent") return "proposal";
  return "evaluation";
}
