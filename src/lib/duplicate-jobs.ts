/**
 * The same visit booked twice.
 *
 * A booking that came in through the app and again through the calendar
 * is two jobs at one address for one person. The board should say so,
 * and the office should be able to take the copy off with one press.
 * This decides which of the two is the copy, and whether a job may be
 * deleted at all. Pure: no reads, no writes.
 */

export interface DuplicateCandidate {
  id: string;
  address: string;
  customerName: string;
  createdAt: string;
  status: string;
  evaluationStatus: string;
  proposalStatus: string | null;
}

export interface DuplicateOf {
  /** The job kept, the one the copy duplicates. */
  keeperId: string;
  keeperLabel: string;
}

/** "3 idlewild ct" from any spelling of the first line. */
export function addressKey(address: string): string {
  return address
    .split(",")[0]
    .toLowerCase()
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(circle|cir)\b/g, "cir")
    .replace(/\b(place|pl)\b/g, "pl")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(terrace|ter)\b/g, "ter")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * How far along a job is. The one furthest along is kept, because it is
 * the one with the proposal, the visit notes and the messages on it.
 */
function progress(job: DuplicateCandidate): number {
  if (job.proposalStatus === "paid" || job.proposalStatus === "accepted") return 5;
  if (job.status === "approved" || job.status === "in_progress" || job.status === "completed") return 5;
  if (job.proposalStatus === "sent" || job.status === "quoted") return 4;
  if (job.proposalStatus) return 3;
  if (job.evaluationStatus === "completed") return 2;
  if (job.evaluationStatus === "scheduled" || job.evaluationStatus === "on_way" || job.evaluationStatus === "arrived") return 1;
  return 0;
}

/**
 * Which live jobs are copies of another, and of which.
 *
 * Two jobs are the same when they sit at the same address for the same
 * name. Cancelled jobs are not on the board and are not counted. In each
 * group the job furthest along is kept; on a tie, the oldest.
 */
export function findDuplicates(jobs: readonly DuplicateCandidate[]): Map<string, DuplicateOf> {
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const job of jobs) {
    if (job.status === "cancelled") continue;
    const key = `${addressKey(job.address)}|${nameKey(job.customerName)}`;
    if (!addressKey(job.address)) continue;
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }
  const out = new Map<string, DuplicateOf>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [keeper, ...copies] = [...list].sort((a, b) => progress(b) - progress(a) || a.createdAt.localeCompare(b.createdAt));
    for (const copy of copies) out.set(copy.id, { keeperId: keeper.id, keeperLabel: keeper.customerName });
  }
  return out;
}

export interface DeleteFacts {
  payments: number;
  invoices: number;
  proposalStatus: string | null;
  workSessions: number;
  timeEntries: number;
}

export type DeleteVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a job can be deleted outright.
 *
 * Money and work are history that must not vanish: a job with a payment,
 * an invoice, an accepted proposal or hours logged is cancelled, never
 * deleted. A copy that only ever held a booking can go.
 */
export function canDeleteJob(facts: DeleteFacts): DeleteVerdict {
  if (facts.payments > 0) return { ok: false, reason: "Money was taken on this job. Cancel it instead of deleting it." };
  if (facts.invoices > 0) return { ok: false, reason: "This job has an invoice. Cancel it instead of deleting it." };
  if (facts.proposalStatus === "accepted" || facts.proposalStatus === "paid") {
    return { ok: false, reason: "The client accepted a proposal on this job. Cancel it instead of deleting it." };
  }
  if (facts.workSessions > 0 || facts.timeEntries > 0) return { ok: false, reason: "Work was logged on this job. Cancel it instead of deleting it." };
  return { ok: true };
}
