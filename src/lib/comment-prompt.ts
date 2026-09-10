/**
 * Writing the comment that goes under somebody's post.
 *
 * A neighbour posts "can anyone recommend a landscaper?" and somebody on the
 * team answers it. The answer has to read like a person who lives nearby, name
 * the thing they actually asked for, and carry the link. Three canned
 * paragraphs could not do the second of those, which is the one that matters:
 * a comment about lawns under a post about a retaining wall is a comment
 * nobody replies to.
 *
 * So the post itself is read and the comment written from it. What is here is
 * the brief and the tidying up — the model call lives in the action, and the
 * link is put in afterwards rather than asked for, because a model asked for a
 * URL will sooner or later invent one.
 */

/** Where the link goes. The model writes this and we swap it, so it is exact. */
export const LINK_MARKER = "ADD LINK";

export interface CommentBrief {
  businessName: string;
  /** What the poster is asking about, when whoever recorded it said so. */
  note: string;
  /** The group or neighbourhood, for tone rather than for content. */
  where: string;
}

/**
 * The rules for the comment, as given by the person whose business it is.
 *
 * Written as instructions rather than as an example, because an example gets
 * copied word for word and ten identical comments in one group is worse than
 * no comments at all.
 */
export function commentSystemPrompt(businessName: string): string {
  const name = businessName.trim() || "our company";
  return [
    `You write Facebook comments for ${name} in response to local homeowners looking for services.`,
    "",
    "You are given a screenshot of a post. Write ONLY the ready-to-paste comment. Do not explain anything, do not add a preamble, and do not wrap it in quotes.",
    "",
    "Structure:",
    `1. If the post looks a few days old, or they may already have found someone, open with: "If you haven't gotten this taken care of yet, I operate ${name}." Otherwise open with: "I operate ${name}."`,
    '2. Then say: "We\'ve been featured in the news, have amazing reviews..." and naturally mention the exact services the person is asking for.',
    "3. Add one or two short sentences showing you understand their specific project and how you can help. Tailor this to the post. Do not sound generic.",
    "4. Always include this call to action, exactly, with the placeholder left as it is:",
    '"You can book a free in-person evaluation or instantly schedule online in under 5 minutes using the link below. It will show all available dates and times so you can choose what works best:',
    "",
    `${LINK_MARKER}"`,
    '5. End with a short friendly sentence such as "Happy to help!", "Happy to take a look!", or "Happy to help if you still need someone!"',
    "",
    "Style:",
    "- Friendly, local, confident, conversational. Never corporate or salesy.",
    "- Keep it relatively short.",
    "- No em dashes.",
    '- Never say "only five-star reviews". Always say "amazing reviews".',
    "- Match the exact service requested in the post.",
    `- For anything ${name} does not do directly, say you can "help coordinate" it through your trusted contractor network.`,
    "- Never invent prices, availability, guarantees, or any detail that is not in the post.",
    "- If the post is humorous or casual, you may lightly match their tone.",
    "- Output only the finished comment.",
  ].join("\n");
}

/** What we can tell the model beyond the picture itself. */
export function commentBrief(brief: CommentBrief): string {
  const lines = ["Here is the post. Write the comment."];
  if (brief.where.trim()) lines.push(`It was posted in: ${brief.where.trim()}`);
  if (brief.note.trim()) lines.push(`What we know about it: ${brief.note.trim()}`);
  return lines.join("\n");
}

/**
 * The comment, cleaned up and with the real link in it.
 *
 * Every rule here is also in the prompt. They are enforced twice because a
 * prompt is a request and this is a comment going out under the business's
 * name in front of the neighbours: a stray em dash is cosmetic, but a missing
 * link is a comment that does nothing at all, and an invented five-star claim
 * is one somebody could be held to.
 */
export function finishComment(raw: string, link: string): string {
  let text = (raw ?? "").trim();

  // Models like to introduce themselves. Strip a leading "Here's the comment:"
  // and any wrapping quotes before anything else looks at the words.
  text = text.replace(/^\s*(?:here(?:'s| is)[^\n:]*:|comment:)\s*/i, "");
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  text = text.replace(/^```[a-z]*\n?|```$/g, "").trim();

  // The claim the owner asked never to make.
  text = text.replace(/only\s+(?:5|five)[\s-]*star\s+reviews/gi, "amazing reviews");
  text = text.replace(/\b(?:5|five)[\s-]*star\s+reviews\b/gi, "amazing reviews");

  // No em dashes. A comma reads the way the sentence was meant to.
  text = text.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");

  // The link, put in rather than asked for.
  if (text.includes(LINK_MARKER)) {
    text = text.split(LINK_MARKER).join(link);
  } else if (!text.includes(link)) {
    text = `${text}\n\n${link}`;
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Whether what came back is worth showing somebody. */
export function looksUsable(text: string, link: string): boolean {
  const body = text.replace(link, "").trim();
  return body.length >= 40 && text.includes(link);
}
