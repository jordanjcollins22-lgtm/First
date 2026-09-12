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
  /**
   * What this business actually does with its own crew.
   *
   * Passed in because without it the model had nothing to check itself
   * against and simply agreed with the post. A neighbour asking about tree
   * removal got a comment saying "we handle tree and mulberry removal", from
   * a business that does not do tree work, alongside a flat claim of being
   * licensed. Both were written because "match the exact service requested"
   * was the only instruction about services in the brief.
   */
  ownServices?: string[];
  /** What gets arranged through somebody else, so the comment can say so. */
  partnerServices?: string[];
  /**
   * How many days ago it was posted, when the screenshot said.
   *
   * The opener turns on this and nothing else. Told outright rather than left
   * to be judged from the picture, because "3d" in grey text at the top of a
   * screenshot is exactly the sort of thing a reader skips, and getting it
   * wrong means opening "if you haven't gotten this taken care of yet" under
   * a post from an hour ago.
   */
  ageDays?: number | null;
}

/**
 * The rules for the comment, as given by the person whose business it is.
 *
 * Written as instructions rather than as an example, because an example gets
 * copied word for word and ten identical comments in one group is worse than
 * no comments at all.
 */
export function commentSystemPrompt(
  businessName: string,
  services: { own?: string[]; partner?: string[] } = {}
): string {
  const name = businessName.trim() || "our company";
  const own = (services.own ?? []).filter(Boolean);
  const partner = (services.partner ?? []).filter(Boolean);
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
    "",
    "What we do, and what we must never claim:",
    own.length > 0
      ? `- Our own crew does exactly these and nothing else: ${own.join(", ")}.`
      : "- You have not been told what our own crew does, so do not claim any specific service at all. Say we would come and take a look.",
    partner.length > 0
      ? `- These we arrange through a partner rather than doing ourselves: ${partner.join(", ")}. Say we can help coordinate it through our trusted contractor network. Never say we do it.`
      : "- Anything not on the list above, say we can help coordinate through our trusted contractor network. Never say we do it.",
    `- Never say ${name} does a service that is not on the list above, however close it sounds to one that is, and however plainly the post asks for it. Agreeing with the post is not worth a claim we cannot stand behind.`,
    "- Tree work in particular: felling, tree removal, large limb work and stump grinding are a licensed trade. Never say we do any of it. We coordinate it.",
    `- Never call ${name} licensed, certified, bonded, accredited or insured. You may say a partner we hire is licensed and insured, because that is about them.`,
    "- Never invent prices, availability, guarantees, or any detail that is not in the post.",
    "- If the post is humorous or casual, you may lightly match their tone.",
    "- Output only the finished comment.",
  ].join("\n");
}

/** What we can tell the model beyond the picture itself. */
export function commentBrief(brief: CommentBrief): string {
  const lines = ["Here is the post. Write the comment."];
  if (brief.where.trim()) lines.push(`It was posted in: ${brief.where.trim()}`);
  // Repeated here as well as in the system prompt. The service list is the
  // one thing in this brief that stops a comment claiming work the business
  // cannot legally do, and a rule stated once at the top of a long prompt is
  // a rule a model weighs against everything after it.
  if ((brief.ownServices ?? []).length > 0) {
    lines.push(`Our own crew does only: ${brief.ownServices!.join(", ")}.`);
  }
  if ((brief.partnerServices ?? []).length > 0) {
    lines.push(`We coordinate these through a partner: ${brief.partnerServices!.join(", ")}.`);
  }
  if (brief.note.trim()) lines.push(`What we know about it: ${brief.note.trim()}`);

  const age = brief.ageDays;
  if (typeof age === "number") {
    lines.push(
      age <= 0
        ? "It was posted today, so use the plain opener."
        : age === 1
          ? "It was posted yesterday, so use the plain opener."
          : `It was posted ${age} days ago, so open with "If you haven't gotten this taken care of yet".`
    );
  }

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

/**
 * Trades this business must never say it does.
 *
 * Not a list of things it is bad at. A list of work that is licensed in
 * Maryland, where saying "we handle tree removal" in a public comment is a
 * claim to hold a licence, and the person who reads it and hires on the
 * strength of it has been told something untrue by a business that meant to
 * be helpful.
 *
 * This is the second line. The prompt is told the same thing, and the prompt
 * is a request: a comment goes out under the business's name in front of
 * three thousand neighbours, and a request is not enough for a claim somebody
 * could be held to.
 */
const RESTRICTED_TRADES: { pattern: RegExp; label: string }[] = [
  // Deliberately loose about what sits between the tree and the verb. The
  // comment that went out said "tree and mulberry removal", which a pattern
  // looking for "tree removal" walks straight past, and that phrasing is
  // exactly what a model writes when it is agreeing with a post about a
  // mulberry. A false flag here costs somebody an edit; a miss costs a claim
  // to hold a licence.
  {
    pattern: /\btrees?\b[^.!?\n]{0,40}\b(?:removal|remove|removing|trimming|trim|cutting|felling|takedown|work|service)/i,
    label: "tree work",
  },
  {
    pattern: /\b(?:removal|removing|trimming|cutting|felling|takedown)\b[^.!?\n]{0,40}\btrees?\b/i,
    label: "tree work",
  },
  { pattern: /\b(?:fell|felling|take down|taking down)\b[^.!?\n]{0,20}\btrees?\b/i, label: "tree work" },
  { pattern: /\bstump grind/i, label: "stump grinding" },
  { pattern: /\belectrical\b|\brewir/i, label: "electrical work" },
  { pattern: /\bplumb(?:ing|er)\b/i, label: "plumbing" },
  { pattern: /\bgas line/i, label: "gas work" },
  { pattern: /\broof(?:ing|er)\b/i, label: "roofing" },
  { pattern: /\bhvac\b/i, label: "HVAC" },
];

/** Wording that makes a sentence about somebody else rather than about us. */
const PARTNER_FRAMING =
  /\b(?:coordinat|partner|contractor network|subcontract|we work with|bring in|refer|connect you|put you in touch|arrange)/i;

/** Saying we hold a licence, a certification or cover. */
const OUR_CREDENTIALS =
  /\b(?:we(?:'re| are)?|our (?:company|business|team|crew)|fully|i am|i'm)\s+(?:fully\s+)?(?:licensed|certified|bonded|accredited|insured)/i;

export interface CommentCheck {
  ok: boolean;
  /** What is wrong, in words somebody can act on. */
  problems: string[];
}

/**
 * Whether this comment is safe to put the business's name on.
 *
 * Two things get a comment stopped, and both actually happened in one
 * comment that went out: claiming a licensed trade the business does not do,
 * and claiming to be licensed and insured.
 *
 * A restricted trade is allowed in a sentence that frames it as somebody
 * else's work, because "we can help coordinate tree removal through our
 * contractor network" is both true and the useful answer to give a neighbour
 * who asked. Checked sentence by sentence rather than across the whole
 * comment, since a coordination line three paragraphs down does not make
 * "we handle tree removal" at the top acceptable.
 */
export function checkComment(text: string): CommentCheck {
  const problems: string[] = [];
  const body = (text ?? "").trim();
  if (!body) return { ok: false, problems: ["There is nothing here."] };

  for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
    for (const trade of RESTRICTED_TRADES) {
      if (!trade.pattern.test(sentence)) continue;
      if (PARTNER_FRAMING.test(sentence)) continue;
      problems.push(
        `Says we do ${trade.label}. That is a licensed trade we do not do, so it has to read as something we coordinate.`
      );
    }
  }

  // Checked sentence by sentence, like the trades above and for the same
  // reason. The comment that went out coordinated stump grinding in one
  // sentence and called itself licensed in another, and reading the whole
  // comment at once let the first excuse the second.
  for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
    if (!OUR_CREDENTIALS.test(sentence)) continue;
    if (PARTNER_FRAMING.test(sentence)) continue;
    problems.push(
      "Claims we are licensed or insured. Say it about a partner we hire, or leave it out."
    );
  }

  // The same thing said twice about two trades is one thing to fix.
  return { ok: problems.length === 0, problems: Array.from(new Set(problems)) };
}

/** Whether what came back is worth showing somebody. */
export function looksUsable(text: string, link: string): boolean {
  const body = text.replace(link, "").trim();
  return body.length >= 40 && text.includes(link) && checkComment(body).ok;
}
