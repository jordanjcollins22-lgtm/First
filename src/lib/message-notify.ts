/**
 * What a conversation notification actually says.
 *
 * A message saved in the app that nobody hears about is a message nobody
 * answers. Both directions were quiet: a client writing on their proposal
 * page notified no one at all, and a text going out to a client arrived as a
 * bare sentence from an unknown number with no way back to the thread.
 *
 * Composing the wording here — rather than inline at the two call sites —
 * keeps it testable, keeps both directions consistent, and keeps the length
 * honest. A text message is billed per 160 characters, so every body gets
 * trimmed rather than trusted.
 */

/** Room for the prefix and the link around a long message body. */
export const BODY_LIMIT = 120;

/** Cuts on a word where it can, and only adds the ellipsis when it actually
 * cut something — "…" on a message that fit reads like it was truncated. */
export function truncateForSms(text: string, limit = BODY_LIMIT): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.trimEnd()}…`;
}

/**
 * The text a client gets when the team writes on the external thread.
 *
 * Named sender first, because the whole point is that they know who this is
 * before they read it, and the thread link last so replying is one tap. The
 * link is optional: a job with no proposal out has nowhere to send them, and
 * a text with a dead link is worse than a text with none.
 */
export function clientMessageText(input: {
  businessName: string;
  body: string;
  link?: string | null;
}): string {
  const from = input.businessName.trim() || "Your crew";
  const parts = [`${from}: ${truncateForSms(input.body)}`];
  if (input.link) parts.push(`Reply here: ${input.link}`);
  return parts.join("\n\n");
}

/** The text a teammate gets when a client writes in. */
export function teamMessageText(input: { clientName: string; body: string; link?: string | null }): string {
  const who = input.clientName.trim() || "A client";
  const parts = [`${who} messaged: ${truncateForSms(input.body)}`];
  if (input.link) parts.push(input.link);
  return parts.join("\n\n");
}

/** The text a teammate gets when another teammate leaves an internal note. */
export function internalNoteText(input: {
  authorName: string;
  jobLabel: string;
  body: string;
  link?: string | null;
}): string {
  const who = input.authorName.trim() || "A teammate";
  const where = input.jobLabel.trim();
  const head = where ? `${who} on ${where}: ` : `${who}: `;
  const parts = [`${head}${truncateForSms(input.body)}`];
  if (input.link) parts.push(input.link);
  return parts.join("\n\n");
}

/**
 * One notification per saved message, per person.
 *
 * Keyed on the message row's id, so a double submit or a retried action
 * cannot text the same person about the same message twice — the id is the
 * only thing that is genuinely unique per message.
 */
export function messageDedupeKey(messageId: string): string {
  return `message:${messageId}`;
}
