/**
 * What happens after the work is done, in order, without anybody pushing it.
 *
 *   last work day closed (or the job marked completed)
 *     → the client's before & after sign-off request (/done)
 *     → the invoice, through the existing Stripe code
 *     → the job-cost snapshot
 *     → "ready for a review request", which workstream A2's review code
 *       watches for (job_completion_chain.review_ready_at)
 *
 * Each step is decided from facts read fresh from the database, so the run is
 * idempotent: a step already done reads as done and is skipped. Pure, so the
 * order is tested without a database.
 */

export interface ChainFacts {
  jobStatus: string;
  /** Every non-cancelled work session is closed, and there was at least one. */
  sessionsAllClosed: boolean;
  /** The newest before & after request, if one exists. */
  review: { status: "sent" | "approved" | "changes"; sentAt: string } | null;
  /** canSendForApproval passed: walked, afters taken. Null reason when ready. */
  closeoutBlockedBy: string | null;
  clientHasEmail: boolean;
  /** "none" when no live invoice exists on the job. */
  invoice: "none" | "open" | "paid" | "uncollectible";
  /** A payment plan or payments already cover the job: no new invoice. */
  billedElsewhere: boolean;
  /** The agreed total, in cents. Zero means nothing to bill. */
  agreedCents: number;
  snapshotAt: string | null;
  snapshotFinal: boolean;
  reviewReadyAt: string | null;
  leadNudgedAt: string | null;
}

export interface ChainSettings {
  /** Bill only once the client has approved the before & afters. */
  invoiceAfterClientApproval: boolean;
  /** A sign-off request unanswered this long is an exception. */
  signoffOverdueHours: number;
}

export type ChainStep =
  | { kind: "send_signoff" }
  | { kind: "nudge_lead"; reason: string }
  | { kind: "raise_invoice" }
  | { kind: "snapshot"; final: boolean }
  | { kind: "review_ready"; reason: ReviewReadyReason };

/** Why a job became ready for a review request. */
export type ReviewReadyReason = "client_approved" | "job_completed" | "invoice_paid";

export interface ChainPlan {
  steps: ChainStep[];
  /** Where the chain is, in words, for the panel. */
  stage: string;
  /** Something a person has to do; shown in the exceptions strip. */
  exception: string | null;
}

export function chainTriggered(facts: Pick<ChainFacts, "jobStatus" | "sessionsAllClosed">): boolean {
  return facts.jobStatus === "completed" || facts.sessionsAllClosed;
}

export function planChain(facts: ChainFacts, settings: ChainSettings, now: Date): ChainPlan {
  const steps: ChainStep[] = [];
  let exception: string | null = null;
  const completed = facts.jobStatus === "completed";
  const approved = facts.review?.status === "approved" || (completed && facts.review == null);

  // 1. Sign-off request. A completed job has been signed off by the existing
  // flow already (it cannot complete without the client's approval), so a
  // completed job never gets a fresh request.
  let stage = "Sign-off requested";
  if (!facts.review && !completed) {
    if (facts.closeoutBlockedBy == null && facts.clientHasEmail) {
      steps.push({ kind: "send_signoff" });
    } else {
      const reason = facts.closeoutBlockedBy ?? "The client has no email on file. Show them in person and record their approval.";
      stage = "Waiting on close-out";
      if (!facts.leadNudgedAt) steps.push({ kind: "nudge_lead", reason });
      exception = `Can't send the sign-off yet: ${reason}`;
    }
  } else if (facts.review?.status === "changes") {
    stage = "Client asked for changes";
    exception = "The client asked for changes on the before & afters.";
  } else if (facts.review?.status === "sent") {
    const waited = (now.getTime() - new Date(facts.review.sentAt).getTime()) / 3_600_000;
    stage = "Waiting on the client";
    if (waited >= settings.signoffOverdueHours) {
      exception = `The client hasn't signed off in ${Math.floor(waited)} hours.`;
    }
  } else if (approved) {
    stage = "Client approved";
  }

  // 2. The invoice.
  const invoiceDue = settings.invoiceAfterClientApproval ? approved : true;
  const billable = facts.agreedCents > 0;
  const invoiceSettled = facts.invoice !== "none" || facts.billedElsewhere || !billable;
  if (!invoiceSettled && invoiceDue) {
    steps.push({ kind: "raise_invoice" });
  }
  // The step counts as dealt with once it has been asked for in this run.
  const invoiceResolved = invoiceSettled || (invoiceDue && steps.some((s) => s.kind === "raise_invoice"));
  if (invoiceResolved && approved) stage = facts.invoice === "paid" ? "Paid" : "Invoiced";

  // 3. The cost snapshot: once the bill is dealt with, and again when the
  // job is finally completed if the first one was taken before that.
  if (invoiceResolved && (!facts.snapshotAt || (!facts.snapshotFinal && completed))) {
    steps.push({ kind: "snapshot", final: completed });
  }

  // 4. The hook the review request watches.
  if (!facts.reviewReadyAt) {
    if (facts.review?.status === "approved") steps.push({ kind: "review_ready", reason: "client_approved" });
    else if (completed && facts.review == null) steps.push({ kind: "review_ready", reason: "job_completed" });
    else if (facts.invoice === "paid") steps.push({ kind: "review_ready", reason: "invoice_paid" });
  }

  return { steps, stage, exception };
}
