/**
 * The account manager's day, worked out from plain rows: which leads to
 * ring and book, which client messages still want an answer, and which
 * invoices are waiting. Pure, so the order things come in is tested rather
 * than hoped for.
 *
 * "Mine" means a client this person manages, or one nobody has claimed
 * yet: an unclaimed client is one nobody is ringing. The same rule the
 * call list and the collections list already use.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A client this person should be working: theirs, or nobody's yet. */
export function isMine(managerId: string | null | undefined, viewerId: string): boolean {
  return managerId == null || managerId === viewerId;
}

/* ------------------------------------------------------------------ */
/* Leads to ring and book                                               */
/* ------------------------------------------------------------------ */

export interface LeadJob {
  jobId: string;
  customerName: string;
  phone: string | null;
  address: string;
  managerId: string | null;
  doNotContact: boolean;
  createdAt: string;
  evaluationDate: string | null;
  evaluationStatus: string | null;
  /** The client, so the same client's jobs at one address count as one lead. */
  customerId?: string | null;
  email?: string | null;
  /** The job's own name: test bookings are named "TEST · ...". */
  jobName?: string | null;
  /** A later job at the same address has gone past estimating (quoted, signed, done). */
  movedOn?: boolean;
}

export type LeadReason = "new" | "rebook" | "missed";

export interface LeadToBook extends LeadJob {
  reason: LeadReason;
  /** What the row says about it, in a few words. */
  why: string;
}

/**
 * Whether a lead still needs a visit booked, and why.
 *
 * - new: no visit on it yet;
 * - rebook: the visit was cancelled or was a no-show;
 * - missed: the visit's time passed a day ago and it still says scheduled,
 *   so nobody went or nobody wrote it up. Worth a call either way.
 */
export function leadReason(job: Pick<LeadJob, "evaluationDate" | "evaluationStatus">, now: Date): LeadReason | null {
  const status = job.evaluationStatus ?? "";
  if (status === "completed") return null;
  if (!job.evaluationDate) return "new";
  if (status === "cancelled") return "rebook";
  const at = new Date(job.evaluationDate).getTime();
  if (!Number.isNaN(at) && at < now.getTime() - DAY && (status === "scheduled" || status === "")) return "missed";
  return null;
}

function age(from: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(from).getTime()) / DAY);
  if (!(days >= 1)) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const REASON_ORDER: Record<LeadReason, number> = { new: 0, rebook: 1, missed: 2 };

/**
 * The leads to ring, newest new lead first: a lead rung inside the hour is
 * the one that books. Rebooks and missed visits follow. Clients marked do
 * not contact, and other people's clients, are left off.
 */
export function leadsToBook(jobs: LeadJob[], viewerId: string, now: Date = new Date()): LeadToBook[] {
  // One lead per client per address: the same yard booked twice, or an
  // estimate started again, is one visit to book (Jordan, Nov 25).
  const groups = new Map<string, LeadJob[]>();
  for (const j of jobs) {
    if (j.doNotContact || !isMine(j.managerId, viewerId) || isTestLead(j)) continue;
    const key = j.customerId ? `${j.customerId}|${j.address.trim().toLowerCase()}` : j.jobId;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  const out: LeadToBook[] = [];
  for (const group of groups.values()) {
    // Already booked, visited, quoted or done under any of its jobs: nothing to book.
    if (group.some((j) => j.movedOn || leadReason(j, now) == null)) continue;
    // The job that carries the visit history speaks for the rest, else the newest.
    const pick = [...group].sort((a, b) => Number(!!b.evaluationDate) - Number(!!a.evaluationDate) || b.createdAt.localeCompare(a.createdAt))[0];
    const reason = leadReason(pick, now)!;
    const why =
      reason === "new" ? `New lead, came in ${age(pick.createdAt, now)}` : reason === "rebook" ? "Visit called off, book another" : "Visit date passed, nothing written up";
    out.push({ ...pick, reason, why });
  }
  return out.sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || b.createdAt.localeCompare(a.createdAt));
}

/**
 * A booking made to try the app, not a client: named TEST, a made-up
 * example.com address, or one of the team booking themselves.
 */
export function isTestLead(j: Pick<LeadJob, "customerName" | "email" | "jobName">): boolean {
  if (/^\s*test\b/i.test(j.customerName) || /^\s*test\b/i.test(j.jobName ?? "")) return true;
  const email = (j.email ?? "").trim().toLowerCase();
  return email.endsWith("@example.com") || email.endsWith("@jslandscapingmd.com");
}

/* ------------------------------------------------------------------ */
/* Client messages still waiting on an answer                          */
/* ------------------------------------------------------------------ */

export interface ClientMessage {
  jobId: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

/**
 * The newest message from each client whose conversation nobody has
 * answered or marked dealt with since. Oldest wait first: the client who
 * has waited longest is the one to ring.
 *
 * `messages` are client-written messages, any order. `answeredThrough` is,
 * per job, the latest of: a reply from the team, or the conversation
 * marked read.
 */
export function waitingMessages(messages: ClientMessage[], answeredThrough: Map<string, string>): ClientMessage[] {
  const newest = new Map<string, ClientMessage>();
  for (const m of messages) {
    const had = newest.get(m.jobId);
    if (!had || m.createdAt > had.createdAt) newest.set(m.jobId, m);
  }
  return [...newest.values()]
    .filter((m) => {
      const through = answeredThrough.get(m.jobId);
      return !through || through < m.createdAt;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The later of two timestamps, either possibly missing. */
export function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/* ------------------------------------------------------------------ */
/* Invoices                                                             */
/* ------------------------------------------------------------------ */

export interface DueInvoice {
  invoiceId: string;
  jobId: string;
  customerName: string;
  managerId: string | null;
  amount: number;
  sentAt: string | null;
  createdAt: string;
  /** Cash or check the client said they'd pay by, waiting to be picked up. */
  payBy: string | null;
}

/**
 * Unpaid invoices on this person's clients: money waiting to be picked up
 * first (the client has already said yes to paying), then the longest
 * outstanding.
 */
export function invoicesDue(list: DueInvoice[], viewerId: string): DueInvoice[] {
  return list
    .filter((i) => isMine(i.managerId, viewerId))
    .sort((a, b) => Number(Boolean(b.payBy)) - Number(Boolean(a.payBy)) || (a.sentAt ?? a.createdAt).localeCompare(b.sentAt ?? b.createdAt));
}

/** "3 days" since an invoice went out, for the row. */
export function outstandingFor(i: Pick<DueInvoice, "sentAt" | "createdAt">, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(i.sentAt ?? i.createdAt).getTime()) / DAY);
  if (!(days >= 1)) return "sent today";
  return `out ${days} day${days === 1 ? "" : "s"}`;
}
