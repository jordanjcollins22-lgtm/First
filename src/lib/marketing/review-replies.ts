/**
 * Answering Google reviews without the owner writing each one.
 *
 * 89% of people expect a business to answer its reviews. A good review gets
 * a short, warm, specific thank-you, posted on its own once that is switched
 * on. A review of three stars or fewer is a conversation the owner should
 * see before it goes out under the business's name, so it is drafted and
 * held for a person: nothing negative is ever answered by the app alone.
 *
 * The draft is written by the model where it is set up, checked here, and
 * replaced by a plain template whenever the check fails or the model can't
 * be reached. Pure.
 */

import { z } from "zod";

export type ReplyPolicy = "auto" | "hold";

/** 4-5 stars post on their own; 1-3 stars, or no stars, wait for a person. */
export function replyPolicy(stars: number | null): ReplyPolicy {
  return stars != null && stars >= 4 ? "auto" : "hold";
}

export interface ReviewForReply {
  author: string | null;
  stars: number | null;
  body: string | null;
}

export const ReplySchema = z.object({
  reply: z.string().describe("The reply, as the business, ready to post. Plain text, no greeting line of its own, no signature."),
});

export function replySystemPrompt(businessName: string): string {
  return [
    `You write replies to Google reviews for ${businessName}, a local landscaping and lawn care company in Harford County, Maryland.`,
    "Write as the business, in the first person plural, warm and plain. Two to four sentences.",
    "Thank the reviewer by first name only. Mention something specific from their review when there is something.",
    "Never offer money, refunds, discounts or free work. Never argue. Never mention that the reply was written by software.",
    "Never include phone numbers, email addresses or links. Never use the reviewer's last name or any address.",
    "For a review of three stars or fewer: acknowledge the problem without excuses, say you want to make it right, and ask them to reach out directly.",
  ].join("\n");
}

export function replyBrief(review: ReviewForReply): string {
  return [
    `Reviewer: ${firstName(review.author) ?? "(no name)"}`,
    `Stars: ${review.stars ?? "unknown"}`,
    `Review: ${review.body?.trim() || "(no text, stars only)"}`,
  ].join("\n");
}

export function firstName(author: string | null): string | null {
  const first = (author ?? "").trim().split(/\s+/)[0];
  if (!first || /^a google user$/i.test(author ?? "")) return null;
  return first.replace(/[^\p{L}'-]/gu, "") || null;
}

const MONEY = /\b(refund|discount|free of charge|for free|money back|coupon|% off|\$\d)/i;
const CONTACT = /(https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]|\b\d{3}[-.\s)]+\d{3}[-.\s]+\d{4}\b)/i;
const SOFTWARE = /\b(ai|a\.i\.|language model|chatbot|automated reply|generated)\b/i;

/** What is wrong with a draft, in words. Empty means it can go. */
export function replyProblems(reply: string, review: ReviewForReply): string[] {
  const problems: string[] = [];
  const text = reply.trim();
  if (text.length < 15) problems.push("Too short.");
  if (text.length > 900) problems.push("Too long.");
  if (MONEY.test(text)) problems.push("Offers money or a discount.");
  if (CONTACT.test(text)) problems.push("Includes a phone number, email or link.");
  if (SOFTWARE.test(text)) problems.push("Mentions software.");
  const last = (review.author ?? "").trim().split(/\s+/).slice(1).join(" ");
  if (last.length > 2 && text.toLowerCase().includes(last.toLowerCase())) problems.push("Uses the reviewer's last name.");
  return problems;
}

/** The plain reply, for when the model isn't set up or its draft failed the check. */
export function fallbackReply(review: ReviewForReply, businessName: string): string {
  const name = firstName(review.author);
  const hi = name ? `Thank you, ${name}` : "Thank you";
  if (review.stars != null && review.stars >= 4) {
    return `${hi}! We really appreciate you taking the time to leave a review, and we're glad you're happy with the work. We look forward to taking care of your yard again. — ${businessName}`;
  }
  return `${hi} for the honest feedback. This isn't the experience we want anyone to have, and we'd like to make it right. Please reach out to us directly so we can talk it through. — ${businessName}`;
}

/** Whether a pulled review goes on the booking page: four or five stars, with words to quote. */
export function belongsOnBookingPage(review: ReviewForReply): boolean {
  return (review.stars ?? 0) >= 4 && (review.body ?? "").trim().length >= 20;
}

/**
 * Whether the app should draft for this review: answered by nobody yet, and
 * written or changed after reviews were switched on. A review from before
 * that waits for a one-off the owner starts on purpose.
 */
export function shouldDraft(input: { reviewedAt: string | null; updatedAt: string | null; hasReply: boolean; startedAt: string | null }): boolean {
  if (input.hasReply || !input.startedAt) return false;
  const at = input.updatedAt ?? input.reviewedAt;
  return Boolean(at && Date.parse(at) >= Date.parse(input.startedAt));
}

export interface ReviewStats {
  count: number;
  average: number | null;
  last30: number;
  responded: number;
  /** Responded over count, or null with none. */
  responseRate: number | null;
}

export function reviewStats(reviews: readonly { stars: number | null; reviewedAt: string | null; replied: boolean }[], now: Date): ReviewStats {
  const rated = reviews.filter((r) => r.stars != null);
  const average = rated.length ? Math.round((rated.reduce((n, r) => n + (r.stars as number), 0) / rated.length) * 10) / 10 : null;
  const cutoff = now.getTime() - 30 * 86_400_000;
  const responded = reviews.filter((r) => r.replied).length;
  return {
    count: reviews.length,
    average,
    last30: reviews.filter((r) => r.reviewedAt && Date.parse(r.reviewedAt) >= cutoff).length,
    responded,
    responseRate: reviews.length ? responded / reviews.length : null,
  };
}
