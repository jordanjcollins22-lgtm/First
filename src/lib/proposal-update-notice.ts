/**
 * Telling a client their proposal changed.
 *
 * Changing a proposal in place is the right thing — same token, same link,
 * no second URL for them to have the wrong one of. It has one failure mode,
 * which is silence: the price moved on a page they are not looking at, and
 * they find out the next time they happen to open it, or at the door.
 *
 * So a change is approved and sent rather than saved. The text says what
 * moved, what it costs now, and points at the link they already have,
 * because a second link is the thing this whole arrangement avoids.
 */

/** Dollars, as somebody would read them out. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface NoticeInput {
  businessName: string;
  /** What came off or changed, already worded. */
  changes: string[];
  previousTotalCents: number;
  newTotalCents: number;
  /** The link they already have. */
  link?: string | null;
}

/**
 * The one line at the top: what actually happened to their quote.
 *
 * Leads with the money, because that is the question. A change with no price
 * movement says so rather than implying one.
 */
export function priceSentence(previousCents: number, newCents: number): string {
  if (newCents === previousCents) return "The price is unchanged.";
  const direction = newCents < previousCents ? "down from" : "up from";
  return `Your total is now ${money(newCents)}, ${direction} ${money(previousCents)}.`;
}

/** The text message a client gets when an update is approved and sent. */
export function updateNoticeText(input: NoticeInput): string {
  const from = input.businessName.trim() || "Your crew";
  const lines = [`${from}: we have updated your proposal.`];

  // At most two changes by name. A text listing six areas is a text nobody
  // reads, and the proposal itself is one tap away saying all of them.
  const named = input.changes.slice(0, 2);
  if (named.length > 0) {
    const more = input.changes.length - named.length;
    lines.push(more > 0 ? `${named.join(". ")}. Plus ${more} more.` : `${named.join(". ")}.`);
  }

  lines.push(priceSentence(input.previousTotalCents, input.newTotalCents));
  if (input.link) lines.push(`Have a look at the same link: ${input.link}`);

  return lines.join("\n\n");
}

/**
 * The note left on the job's own thread, so the office can see what the
 * client was told without reading their phone.
 */
export function updateThreadNote(input: NoticeInput): string {
  const parts = [`Proposal update sent. ${priceSentence(input.previousTotalCents, input.newTotalCents)}`];
  if (input.changes.length > 0) parts.push(input.changes.join(". ") + ".");
  return parts.join(" ");
}

/** Whether there is anything worth telling a client about. */
export function worthSending(input: { changes: string[]; previousTotalCents: number; newTotalCents: number }): boolean {
  return input.changes.length > 0 || input.newTotalCents !== input.previousTotalCents;
}
