import { checkComment } from "@/lib/comment-prompt";

/**
 * What actually went up, compared with what was written.
 *
 * The writer produces a draft and the board keeps it. What gets pasted into
 * the group is often something else: the draft with a sentence cut, or the
 * person's own words with the link dropped in. Opens are counted against the
 * link either way, so the numbers were never wrong; what was missing was the
 * words the numbers belong to. When a wording gets replies it is worth
 * knowing which wording, and when a claim has to be checked it is worth
 * knowing what was claimed.
 */

export type PostedVersion = "as_written" | "edited" | "own";

/** Whitespace and case do not make a different comment. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whether what was posted is the draft, a changed draft, or their own words.
 *
 * "Edited" is a judgement about how much survived: over half of the draft's
 * sentences still there means somebody trimmed it; less means they started
 * again and this is their wording, with or without a look at ours.
 */
export function postedVersion(draft: string | null | undefined, posted: string): PostedVersion {
  if (!draft?.trim()) return "own";
  if (normalise(draft) === normalise(posted)) return "as_written";
  const sentences = draft
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normalise)
    .filter((line) => line.length > 12);
  if (sentences.length === 0) return "edited";
  const body = normalise(posted);
  const kept = sentences.filter((line) => body.includes(line)).length;
  return kept * 2 >= sentences.length ? "edited" : "own";
}

export const VERSION_LABEL: Record<PostedVersion, string> = {
  as_written: "Posted as written",
  edited: "Posted, edited",
  own: "Posted in their own words",
};

export interface PostedCheck {
  /** Whether the tracked link is in what was posted. Without it, opens
   * cannot be counted and the post is a post rather than a lead. */
  hasLink: boolean;
  /** The same claims check every draft goes through. A pasted comment is
   * already in front of the neighbours, so these are things to go and fix
   * rather than reasons to refuse the record. */
  problems: string[];
  version: PostedVersion;
}

/** The link as it might have been pasted: with or without the scheme, trailing slash or not. */
export function containsLink(text: string, link: string): boolean {
  const bare = link.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  if (!bare) return false;
  return text.toLowerCase().includes(bare);
}

export function checkPosted(input: { draft: string | null | undefined; posted: string; link: string }): PostedCheck {
  const body = input.posted.trim();
  const check = checkComment(body.replace(input.link, "").replace(input.link.replace(/^https?:\/\//i, ""), ""));
  return {
    hasLink: containsLink(body, input.link),
    problems: body ? check.problems : ["There is nothing here."],
    version: postedVersion(input.draft, body),
  };
}

/** The one line the form shows after recording, saying what it noticed. */
export function postedSummary(check: PostedCheck): string {
  const parts: string[] = [VERSION_LABEL[check.version] + "."];
  if (!check.hasLink) parts.push("Your link is not in it, so opens cannot be counted. Add it as a reply under your comment.");
  if (check.problems.length > 0) parts.push(`Worth fixing on the post: ${check.problems.join(" ")}`);
  return parts.join(" ");
}

export const MAX_POSTED_CHARS = 4000;
