/**
 * Where a sale has got to, between the walkthrough and a yes or a no.
 *
 * Five steps, read off what is already recorded: the walkthrough handed in,
 * the price set, the proposal sent, the client opening it, and their answer.
 * Anything that has sat too long says so, in the words of what to do about
 * it. Pure, so the rules are tested rather than eyeballed.
 */

export const SALES_STEPS = ["Walkthrough", "Priced", "Sent", "Opened", "Decision"] as const;

export type SalesOutcome = "won" | "lost" | null;

export interface SalesInput {
  walkthroughAt: string | null;
  proposalStatus: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  /** Every time the client opened it, newest last. */
  views: string[];
  respondedAt: string | null;
  expiresAt: string | null;
  /** The client's latest message after it was sent, when nobody on the team has answered it. */
  unansweredQuestionAt: string | null;
}

export interface SalesStage {
  /** Index into SALES_STEPS of the step it is on. */
  step: number;
  now: string;
  since: string | null;
  outcome: SalesOutcome;
  /** Something needs doing, said as the thing to do. */
  issues: string[];
  /** Red: a client is waiting on us, or the price is about to run out. */
  urgent: boolean;
}

const DAY = 86_400_000;
const daysSince = (iso: string, now: Date) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function salesStage(input: SalesInput, now: Date = new Date()): SalesStage {
  const issues: string[] = [];
  let urgent = false;

  if (input.proposalStatus === "accepted") {
    return { step: 4, now: "Accepted: sold", since: input.respondedAt, outcome: "won", issues, urgent };
  }
  if (input.proposalStatus === "declined") {
    return { step: 4, now: "Declined", since: input.respondedAt, outcome: "lost", issues, urgent };
  }

  if (input.unansweredQuestionAt) {
    issues.push("They asked a question. Answer it in Conversations.");
    urgent = true;
  }

  if (input.sentAt) {
    const opened = input.views.filter((v) => v >= input.sentAt!);
    if (input.expiresAt) {
      const left = Math.ceil((new Date(input.expiresAt).getTime() - now.getTime()) / DAY);
      if (left < 0) {
        issues.push("The price has run out. Send them a fresh one or call.");
        urgent = true;
      } else if (left <= 2) {
        issues.push(`The price runs out in ${plural(left, "day")}. Call them.`);
        urgent = true;
      }
    }
    if (opened.length > 0) {
      const last = opened[opened.length - 1];
      const waited = daysSince(last, now);
      if (waited >= 3) issues.push(`Opened ${plural(opened.length, "time")}, no answer in ${plural(waited, "day")}. Follow up.`);
      return { step: 4, now: `Opened ${plural(opened.length, "time")}, waiting on their answer`, since: last, outcome: null, issues, urgent };
    }
    const waited = daysSince(input.sentAt, now);
    if (waited >= 2) issues.push(`Not opened in ${plural(waited, "day")}. Check they got it, or text the link.`);
    return { step: 3, now: "Sent, not opened yet", since: input.sentAt, outcome: null, issues, urgent };
  }

  if (input.approvedAt) {
    issues.push("Priced but not sent. Send it from the price card.");
    return { step: 2, now: "Priced, ready to send", since: input.approvedAt, outcome: null, issues, urgent };
  }

  if (input.walkthroughAt) {
    const waited = daysSince(input.walkthroughAt, now);
    if (waited >= 1) issues.push(`Walkthrough handed in ${plural(waited, "day")} ago and not priced yet. Price it.`);
    return { step: 1, now: "Walkthrough in, waiting to be priced", since: input.walkthroughAt, outcome: null, issues, urgent };
  }

  return { step: 0, now: "Waiting on the walkthrough", since: null, outcome: null, issues, urgent };
}

/** What each step of the bar shows: done, the one it is on, or still to come. */
export function salesStepState(index: number, stage: SalesStage): "done" | "now" | "todo" | "lost" {
  if (stage.outcome === "won") return "done";
  if (stage.outcome === "lost") return index === 4 ? "lost" : "done";
  if (index < stage.step) return "done";
  if (index === stage.step) return "now";
  return "todo";
}
