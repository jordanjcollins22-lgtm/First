/**
 * The Google review ask, feedback first.
 *
 * Set off when a client approves the before and afters (/done) or pays the
 * invoice. Within two hours (inside the hours we may text) they get a text,
 * or an email when a text cannot go, with a link to a one-tap 1–5 rating.
 * A five is sent straight on to the business's Google review page; anything
 * lower comes to the owner as something to fix, and the client is thanked
 * and still shown the Google link, small, because Google's rules forbid
 * hiding it from unhappy customers and because it is the honest thing to do.
 * One reminder on day 3 if they have not tapped a rating.
 *
 * Skipped for anybody who has already been sent on to Google, has a
 * five-star review recorded on a job, or was asked in the last twelve months.
 *
 * Pure.
 */

import type { Channel } from "@/lib/client-consent";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type ReviewTrigger = "signoff" | "paid";

/** How long after the trigger the first ask is still worth sending. */
export const FIRST_ASK_WINDOW_HOURS = 48;

export interface ReviewHistory {
  /** Any job of theirs marked as having a five-star review. */
  hasRecordedReview: boolean;
  /** Earlier requests to this client: when made, and whether sent on to Google. */
  earlier: { createdAt: Date; sentToGoogleAt: Date | null }[];
}

export type ReviewSkip = "already_reviewed" | "asked_recently" | null;

/** Whether this client should not be asked again, and why. */
export function reviewSkipReason(history: ReviewHistory, now: Date, cooldownMonths: number): ReviewSkip {
  if (history.hasRecordedReview || history.earlier.some((r) => r.sentToGoogleAt)) return "already_reviewed";
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - cooldownMonths);
  if (history.earlier.some((r) => r.createdAt.getTime() > cutoff.getTime())) return "asked_recently";
  return null;
}

/**
 * Which message is due for a request, if any. "ask" from the trigger until
 * the window closes; "reminder" from day N for one day, only if no rating
 * came back. The caller removes what the log says already went.
 */
export function reviewStepDue(input: {
  triggeredAt: Date;
  ratedAt: Date | null;
  now: Date;
  reminderDays: number;
}): "ask" | "reminder" | null {
  if (input.ratedAt) return null;
  const since = input.now.getTime() - input.triggeredAt.getTime();
  if (since < 0) return null;
  const reminderAt = input.reminderDays * DAY;
  if (since >= reminderAt && since <= reminderAt + DAY) return "reminder";
  if (since <= FIRST_ASK_WINDOW_HOURS * HOUR) return "ask";
  return null;
}

export function reviewDedupeKey(requestId: string, step: "ask" | "reminder", channel: Channel): string {
  return `review_request:${requestId}:${step}:${channel}`;
}

/** Where a rating goes: fives to Google (when a link is set), the rest to the owner. */
export function routeRating(rating: number, googleLink: string): "google" | "owner" | "thanks" {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "thanks";
  if (rating === 5) return googleLink ? "google" : "thanks";
  return "owner";
}

export function lowRatingKey(requestId: string): string {
  return `low_rating:${requestId}`;
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

export function reviewMessage(input: {
  step: "ask" | "reminder";
  channel: Channel;
  businessName: string;
  clientName: string | null;
  link: string;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const line =
    input.step === "ask"
      ? `${hi}thank you for having us. How did we do? One tap, 1 to 5:`
      : `${hi}if you have a second, we'd love to know how the work went. One tap, 1 to 5:`;
  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line} ${input.link}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.businessName, input.unsubscribeUrl ? `Not want these? ${input.unsubscribeUrl}` : null].filter((p): p is string => Boolean(p));
  return { subject: input.step === "ask" ? "How did we do?" : "A quick question about your project", body: [line, input.link, ...foot].join("\n\n") };
}
