/**
 * The one thing the conversation agent does: suggest what to say next.
 *
 * It writes drafts. It never sends anything, never books anything, and never
 * changes a record — a person reads each suggestion, edits it or ignores it,
 * and presses send themselves. That limit is the point rather than a
 * precaution: a quote is a conversation with a customer's money in it, and an
 * agent that could send on its own would have to be trusted with that.
 *
 * What it is for is the gap between "the client went quiet" and somebody
 * finding the time to work out what to say. The two things that stall a job
 * are a quote nobody answered and a date nobody pinned down, so that is what
 * the suggestions push at.
 *
 * Everything here is pure: the facts in, the drafts out, and the rules about
 * what a draft is allowed to say. The model call lives in the action.
 */

export const MAX_SUGGESTIONS = 3;

/** Long enough to say something real, short enough to read on a lock screen. */
export const MAX_CHARS = 320;

export interface ThreadLine {
  /** "client" or "team". */
  from: string;
  body: string;
  /** ISO. Used only to say how long the silence has been. */
  at: string;
}

/**
 * What the agent is allowed to know.
 *
 * Assembled from the job rather than handed the database: a suggestion is only
 * as good as the facts behind it, and facts it cannot see it cannot invent.
 */
export interface NudgeContext {
  customerName: string;
  propertyAddress: string;
  /** Where the job actually is: "evaluation", "proposal", "scheduled"... */
  stage: string;
  /** The next thing owed on the job, already worded. */
  dueNext: string | null;
  proposalStatus: string | null;
  /** In cents, as the proposal currently stands. */
  proposalTotalCents: number | null;
  /** Whether they have been reading it, already worded. */
  proposalActivity: string | null;
  paid: boolean;
  /** The booked start, if there is one. */
  startDate: string | null;
  /** Newest last. */
  recentMessages: ThreadLine[];
}

// ---------------------------------------------------------------------------
// The facts, as the model sees them
// ---------------------------------------------------------------------------

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Whole days since the last thing anybody said. Null on an empty thread. */
export function daysSinceLastMessage(context: NudgeContext, now: Date): number | null {
  const last = context.recentMessages[context.recentMessages.length - 1];
  if (!last) return null;
  const at = new Date(last.at).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}

/** Who spoke last, which decides whether this is a reply or a nudge. */
export function waitingOnUs(context: NudgeContext): boolean {
  const last = context.recentMessages[context.recentMessages.length - 1];
  return last?.from === "client";
}

/**
 * The facts, written out for the model.
 *
 * Plain sentences rather than JSON: the model writes better messages from
 * something that reads like a handover than from a record dump, and a fact
 * that cannot be phrased is usually a fact not worth sending.
 */
export function contextBlock(context: NudgeContext, now: Date): string {
  const lines: string[] = [
    `Customer: ${context.customerName || "unknown"}`,
    `Property: ${context.propertyAddress || "unknown"}`,
    `Where the job is: ${context.stage}`,
  ];

  if (context.dueNext) lines.push(`Next thing owed on our side: ${context.dueNext}`);
  if (context.proposalStatus) lines.push(`Proposal status: ${context.proposalStatus}`);
  if (context.proposalTotalCents != null) {
    lines.push(`Proposal total: ${money(context.proposalTotalCents)}`);
  }
  if (context.proposalActivity) lines.push(`Have they opened it: ${context.proposalActivity}`);
  lines.push(`Paid: ${context.paid ? "yes" : "not yet"}`);
  if (context.startDate) lines.push(`Booked to start: ${context.startDate}`);

  const days = daysSinceLastMessage(context, now);
  if (days != null) {
    lines.push(
      days === 0 ? "Last message: today" : `Last message: ${days} day${days === 1 ? "" : "s"} ago`
    );
  }
  // Written without a dash like everything else here. The facts are the last
  // thing the model reads before it writes, and a dash in front of it is an
  // invitation to use one.
  lines.push(
    waitingOnUs(context) ? "They spoke last, so this is a reply." : "We spoke last, so this is a nudge."
  );

  lines.push("", "The conversation so far, oldest first:");
  if (context.recentMessages.length === 0) {
    lines.push("(nothing said yet)");
  } else {
    for (const message of context.recentMessages) {
      lines.push(`${message.from === "client" ? "Them" : "Us"}: ${message.body}`);
    }
  }

  return lines.join("\n");
}

/** What the agent is, and the two things it is aiming at. */
export function systemPrompt(): string {
  return [
    "You draft short messages for a landscaping business to send to a customer. You are writing on behalf of the office, to the customer.",
    "",
    "Two goals, in this order: get the next date in the diary, and get an unanswered quote answered. Every draft should move one of those forward.",
    "",
    "Rules:",
    "- Write what would actually be sent. No greetings block, no sign-off, no subject line. One short paragraph, two at the very most.",
    "- Only use facts you were given. Never state a price, a total, or a discount that is not in the facts above.",
    "- Never promise a date. Ask which day suits them, or offer to look at the diary. The office books the crew, not you.",
    "- Do not apologise for chasing, do not say you are following up on a follow-up, and do not mention this being automated.",
    "- Say one thing and ask one question. A message with two questions gets one answer.",
    "- Match the customer's register. If they write in short lines, write in short lines.",
    "- Never use a dash to join two thoughts. Use a comma, or start a new sentence. A message full of dashes reads as though a machine wrote it, which is the one thing it must not do.",
    "",
    `Give exactly ${MAX_SUGGESTIONS} different drafts, each taking a different angle. Put each on its own line with no numbering, no quotes and no commentary. Nothing else in your reply.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reading the model's answer
// ---------------------------------------------------------------------------

/**
 * Takes the dashes out of a draft.
 *
 * A model reaches for an em dash to join two thoughts, several times a
 * paragraph, and it is the single clearest tell that nobody typed this. The
 * system prompt asks for none, but a prompt is a request rather than a
 * guarantee, so the drafts are cleaned on the way out too.
 *
 * A comma is what somebody writing quickly would have used. The tidy-up after
 * it matters as much as the replacement: turning "ready — and" into
 * "ready, and" is right, but leaving ",," or " ," behind swaps one tell for
 * another.
 */
export function plainDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    // A dash that landed next to punctuation that was already there.
    .replace(/,\s*([,.!?;:])/g, "$1")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strips the bullet, number or quote a model reaches for out of habit. */
function tidy(line: string): string {
  return line
    .trim()
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^["“](.*)["”]$/, "$1")
    .trim();
}

export function parseSuggestions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = plainDashes(tidy(raw));
    if (!line) continue;
    // A model that explains itself first produces a line that is about the
    // drafts rather than one of them.
    if (line.length > MAX_CHARS) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length === MAX_SUGGESTIONS) break;
  }

  return out;
}

/** Every dollar figure in a piece of text, normalised for comparison. */
export function moneyMentioned(text: string): string[] {
  const found = text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  return found.map((m) => m.replace(/[\s,]/g, "").replace(/\.00$/, ""));
}

/**
 * Drops a draft that quotes a price we did not give it.
 *
 * The one mistake here that costs real money is a number. A wrong day is a
 * conversation; a wrong total is a total somebody has now been told, and a
 * business that has to correct its own quote has lost the sale either way.
 * So a draft naming a figure that is not in the facts does not get shown at
 * all rather than being shown with a warning on it.
 */
export function safeSuggestions(suggestions: string[], factsText: string): string[] {
  const known = new Set(moneyMentioned(factsText));
  return suggestions.filter((suggestion) =>
    moneyMentioned(suggestion).every((amount) => known.has(amount))
  );
}

// ---------------------------------------------------------------------------
// When there is no model
// ---------------------------------------------------------------------------

/**
 * Drafts written from the facts alone.
 *
 * Used when the API key is missing or the call fails, and worth having for its
 * own sake: most of these conversations are the same three situations, and a
 * suggestion that appears instantly and needs one edit beats a better one that
 * needs a round trip. Nothing here invents a number or a date either.
 */
export function fallbackSuggestions(context: NudgeContext, now: Date): string[] {
  const first = context.customerName.trim().split(/\s+/)[0] || "there";
  const days = daysSinceLastMessage(context, now);

  if (waitingOnUs(context)) {
    return [
      `Hi ${first}, got your message, thanks. Let me get you a proper answer today.`,
      `Hi ${first}, thanks for that. Is there a day this week that would suit you for us to come out?`,
    ];
  }

  if (context.proposalStatus === "sent" && !context.paid) {
    const opened = context.proposalActivity?.toLowerCase().includes("not opened");
    return [
      opened
        ? `Hi ${first}, just checking the proposal reached you alright. Happy to walk through it on the phone if that is easier.`
        : `Hi ${first}, saw you had a look at the proposal. Anything on it you want me to go through?`,
      `Hi ${first}, is there anything holding this up on your end? If the timing is the issue we can look at the diary and work around you.`,
      `Hi ${first}, happy to start whenever suits. Which day of the week generally works best for you?`,
    ];
  }

  if (context.paid && !context.startDate) {
    return [
      `Hi ${first}, you are all paid up, thank you. Which days generally suit you and I will get you on the crew's diary.`,
    ];
  }

  if (context.startDate) {
    return [
      `Hi ${first}, just confirming we are still good for your booked day. Anything you need us to know before we arrive?`,
    ];
  }

  return [
    days != null && days > 3
      ? `Hi ${first}, checking in on this one. Where are you up to, and is there anything you need from us?`
      : `Hi ${first}, anything you need from us to move this along?`,
  ];
}
