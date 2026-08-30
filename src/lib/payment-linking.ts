/**
 * Joining an imported payment to the job it paid for.
 *
 * The client is usually easy: the file carries an email or a phone. The job
 * is the hard half. A client with one job has one answer; a client with four
 * has four, and picking the wrong one marks the wrong work paid and moves the
 * wrong card down the board.
 *
 * So this only picks where the evidence picks for it, and says it cannot
 * where it cannot. A payment attached to the client and to no job is still
 * worth having: it says what they paid and when, and it is a short list for
 * somebody to assign. A payment attached to the wrong job is worse than one
 * attached to none, because nobody goes looking for it.
 */

/** How near a payment has to be to a quote to be that quote's payment. Money
 * arrives short of the total often enough — a deposit, a discount agreed on
 * the phone, a card fee — that an exact match would attach almost nothing. */
export const AMOUNT_TOLERANCE = 0.05;

export interface JobCandidate {
  jobId: string;
  /** What its proposal says it costs, in cents. Null where there is no
   * proposal, or none with a price on it. */
  totalCents: number | null;
  /** Already settled. A second payment is not a second job. */
  paid: boolean;
  /** Newest first is decided by the caller; this is only used to break ties. */
  createdAt: string;
}

export type LinkReason =
  /** Only one job on this client, so there is nothing to get wrong. */
  | "only_job"
  /** Its quote matches what they paid. */
  | "amount_matches"
  /** Several jobs and nothing to tell them apart. */
  | "ambiguous"
  /** The client has no jobs at all. */
  | "no_jobs";

export interface JobLink {
  jobId: string | null;
  reason: LinkReason;
}

function near(amountCents: number, totalCents: number): boolean {
  if (totalCents <= 0) return false;
  return Math.abs(amountCents - totalCents) <= totalCents * AMOUNT_TOLERANCE;
}

/**
 * Which job this payment belongs to, when that can be known.
 *
 * Order matters. One unpaid job is the answer whatever the amount says, since
 * a deposit against the only job on file is still against that job. Beyond
 * that the amount has to do the work, and it has to pick exactly one — two
 * jobs quoted at the same price is precisely the case where a guess would be
 * wrong half the time.
 */
export function linkToJob(amountCents: number, jobs: JobCandidate[]): JobLink {
  if (jobs.length === 0) return { jobId: null, reason: "no_jobs" };

  // An already-settled job is not what a new payment is for, unless it is the
  // only thing there is.
  const unpaid = jobs.filter((job) => !job.paid);
  const pool = unpaid.length > 0 ? unpaid : jobs;

  if (pool.length === 1) return { jobId: pool[0].jobId, reason: "only_job" };

  const matching = pool.filter((job) => job.totalCents != null && near(amountCents, job.totalCents));
  if (matching.length === 1) return { jobId: matching[0].jobId, reason: "amount_matches" };

  return { jobId: null, reason: "ambiguous" };
}

/** Whether this link is confident enough to mark a job paid, as opposed to
 * merely recording the money against the client. */
export function mayMarkPaid(link: JobLink): boolean {
  return link.jobId !== null;
}

/** What the import report says about one row, in words somebody can act on. */
export function linkLabel(link: JobLink): string {
  switch (link.reason) {
    case "only_job":
      return "Matched to their only job.";
    case "amount_matches":
      return "Matched to the job it pays for.";
    case "ambiguous":
      return "Several jobs and nothing to tell them apart. Recorded against the client for somebody to assign.";
    case "no_jobs":
      return "No job on this client yet. Recorded against them.";
  }
}

export interface ImportTally {
  recorded: number;
  linked: number;
  unlinked: number;
  skipped: number;
  /** Money given back. Counted so the file reconciles, never written into
   * payments, which is what the business actually took. */
  refunded: number;
  /** Failed or still pending. Not money, and not recorded as any. */
  notSettled: number;
  /** Payers nobody had on file, made as contacts so the money had somewhere
   * to land rather than being dropped. */
  clientsCreated: number;
  /** What the card processor took, recorded as an expense rather than
   * quietly deducted from what the client paid. */
  feesCents: number;
  /** What actually went in, in cents. */
  totalCents: number;
  /** Payments the card processor had already recorded live, updated in place
   * rather than added a second time. */
  mergedWithExisting: number;
}

/** The sentence at the end of an import. */
export function tallyLine(tally: ImportTally): string {
  if (tally.recorded === 0) return "Nothing new to bring in. Every row was already here.";

  const money = (tally.totalCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const parts = [`${tally.recorded} ${tally.recorded === 1 ? "payment" : "payments"} in, ${money}`];
  if (tally.linked > 0) parts.push(`${tally.linked} matched to a job`);
  if (tally.unlinked > 0) {
    parts.push(`${tally.unlinked} waiting for somebody to say which job`);
  }
  if (tally.clientsCreated > 0) {
    parts.push(
      `${tally.clientsCreated} new ${tally.clientsCreated === 1 ? "contact" : "contacts"} made for payers nobody had`
    );
  }
  // Said every time, so the number on screen can be reconciled against the
  // file rather than leaving somebody to wonder where the rest went.
  if (tally.refunded > 0) parts.push(`${tally.refunded} refunded, not counted as taken`);
  if (tally.notSettled > 0) parts.push(`${tally.notSettled} failed or pending, not counted`);
  if (tally.feesCents > 0) {
    const fees = (tally.feesCents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    parts.push(`${fees} of card fees recorded as an expense`);
  }
  if (tally.mergedWithExisting > 0) {
    parts.push(
      `${tally.mergedWithExisting} already recorded by the card processor, updated rather than duplicated`
    );
  }
  if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
  return `${parts.join(". ")}.`;
}
