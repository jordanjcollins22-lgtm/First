/**
 * Going back for a post's link. A post read without one (Facebook hides
 * them on search pages) is looked for again inside its own group, by what
 * it says, and the post that comes back saying the same thing is taken to
 * be it. Pure, so the matching is tested.
 */

import { postOpening } from "@/lib/outreach-agent";

/** How many times one post is looked for before it is left to the find-it button. */
export const HUNT_MAX_TRIES = 3;
/** How long before a post handed out and not reported is handed out again. */
export const HUNT_RETRY_MS = 2 * 60 * 60_000;
/** How far back posts are looked for: older than this, the comment is late anyway. */
export const HUNT_WITHIN_DAYS = 3;
/** The share of the post's opening words the one found has to have. */
export const HUNT_MATCH = 0.7;

const tokens = (text: string) =>
  (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** The words to search for: the post's own opening, eight words. */
export function huntWords(text: string, names: (string | null | undefined)[] = []): string {
  return postOpening(text, names).split(/\s+/).slice(0, 8).join(" ");
}

/** Where to look: the group's own search when the group is known, else Facebook's. */
export function huntUrl(words: string, groupKey: string | null): string {
  const q = encodeURIComponent(words);
  if (groupKey && /^[\w.-]+$/.test(groupKey)) return `https://www.facebook.com/groups/${groupKey}/search/?q=${q}`;
  return `https://www.facebook.com/search/posts?q=${q}`;
}

/** How much of `words` is in `text`, from 0 to 1. */
export function overlap(words: string, text: string): number {
  const want = tokens(words);
  if (want.length === 0) return 0;
  const have = new Set(tokens(text));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** Whether what was found is the post that was looked for. */
export function samePost(stored: string, found: string, names: (string | null | undefined)[] = []): boolean {
  const words = postOpening(stored, names).split(/\s+/).slice(0, 25).join(" ");
  return overlap(words, found) >= HUNT_MATCH;
}
