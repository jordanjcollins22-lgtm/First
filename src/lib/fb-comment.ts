import { referralMessage, type SenderRole } from "@/lib/referral-message";

/**
 * The comment the lead finder types under a neighbour's post.
 *
 * The same words as an affiliate's "Posted asking for help" message, so the
 * wording rules live in one place: the sender says who they are by role,
 * answers the post rather than saying it was seen, never promises "free",
 * and carries their own tracked link. Facebook posts a comment on Enter, so
 * it goes in as one paragraph rather than the text-message layout.
 */
export function facebookComment(input: { author: string | null; link: string; business: string; from: string | null; role: SenderRole }): string {
  return referralMessage({ name: input.author ?? "", affiliation: "online_post", link: input.link, business: input.business, from: input.from, role: input.role })
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
