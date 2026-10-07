/**
 * Every message the quick mow funnel sends, word for word. The team alerts
 * go only once quick mow alerts are switched on; the client email goes only
 * when a person has read it and pressed Send.
 */

export function requestAlert(input: { name: string; phone: string; address: string; price: string | null }): string {
  return (
    `New quick mow request: ${input.name}, ${input.phone}. ${input.address}. ` +
    (input.price ? `Saw ${input.price} for the first mow. ` : "No instant price, needs a quote. ") +
    "Not paid yet. Call within 2 minutes."
  );
}

export function paidAlert(input: { name: string; phone: string; address: string; paid: string; day: string | null }): string {
  return (
    `PAID quick mow: ${input.name} paid ${input.paid}` +
    (input.day ? ` for ${input.day}` : "") +
    `. ${input.address}. Call now to confirm: ${input.phone}.`
  );
}

export interface WelcomeInput {
  firstName: string;
  address: string;
  day: string | null;
  paid: string;
  business: string;
  phone: string | null;
  sender: string | null;
  /** Real reviews from the booking page's proof, quoted as written. Empty means none are quoted. */
  reviews: { author: string; body: string }[];
}

/** The "before your mow" email: what was bought, what happens, and what other clients said. */
export function welcomeEmail(input: WelcomeInput): { subject: string; body: string } {
  const quotes = input.reviews
    .slice(0, 2)
    .map((r) => `"${r.body.trim()}"\n${r.author.trim()}`)
    .join("\n\n");
  const sign = [input.sender, input.business].filter(Boolean).join("\n");
  const body =
    `Hi ${input.firstName},\n\n` +
    `Thanks for booking your first mow with us. Here's what you've got:\n\n` +
    `Address: ${input.address}\n` +
    (input.day ? `Day: ${input.day}\n` : "") +
    `Paid: ${input.paid}\n\n` +
    `What happens on the day:\n` +
    `We mow the lawn, trim and edge along the walks and beds, and blow the clippings off your walks and driveway. You don't need to be home; just leave the gate unlocked and let us know about any pets.\n\n` +
    (quotes ? `What our clients say:\n\n${quotes}\n\n` : "") +
    `If anything changes, ${input.phone ? `call or text ${input.phone}` : "reply to this email"}.\n\n` +
    `See you soon,\n${sign}`;
  return { subject: `Your first mow${input.day ? ` on ${input.day}` : ""}`, body };
}
