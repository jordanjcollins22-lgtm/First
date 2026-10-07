/**
 * One look at the post: what it says, and what we say back.
 *
 * Reading the screenshot and writing the comment were two separate calls,
 * the second waiting on a button press, so the person stood in the garden
 * through two model runs and three round trips. The reading and the writing
 * need the same picture and the same facts, so they are one call now. The
 * link goes in afterwards: it does not exist until the record is written,
 * and a model asked for a URL will sooner or later invent one.
 *
 * Nothing here calls anything. It builds the brief and reads the answer.
 */

import { LINK_MARKER } from "@/lib/comment-prompt";
import { parseObject, readingSystemPrompt, readPost, type PostReading, type ReadingBrief } from "@/lib/post-reading";

export interface ReadAndDraft {
  reading: PostReading | null;
  /** The comment with the placeholder still in it, or null when none came back. */
  comment: string | null;
}

/**
 * The two briefs as one.
 *
 * The reading contract first, because it is strict JSON and the parser is
 * built for it; the comment rules after, and the comment travels inside the
 * same object as one more field.
 */
export function readAndDraftSystemPrompt(input: {
  reading: ReadingBrief;
  /** The full comment or reply rules, as the comment writer would get them. */
  writing: string;
  /** "comment" or "reply", for the sentence that joins the two. */
  what: "comment" | "reply";
}): string {
  return [
    readingSystemPrompt(input.reading),
    "",
    `Then, in the same JSON object, add one more field: "${input.what}": the finished ${input.what} as a string, written to the rules below. Leave the placeholder ${LINK_MARKER} exactly where the link goes. When kind is "promotion" or "other", set "${input.what}" to null.`,
    "",
    "Rules for the " + input.what + ":",
    input.writing,
  ].join("\n");
}

/** The answer taken apart: the reading through the strict parser, the words beside it. */
export function parseReadAndDraft(raw: string, services: readonly string[], what: "comment" | "reply"): ReadAndDraft {
  const reading = readPost(raw, services);
  const parsed = parseObject(raw);
  const text = parsed?.[what];
  const comment = typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
  return { reading, comment };
}
