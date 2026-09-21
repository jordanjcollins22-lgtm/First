/**
 * The email that carries a proposal to the client.
 *
 * Approving a proposal makes its link live; this is the note that hands
 * the link over. It is written here and parked for the owner to read,
 * change and send from My Day, because the words a client reads first
 * are worth a look by a person. Pure: nothing here sends.
 */
export interface ProposalReadyInput {
  clientName: string;
  address: string;
  /** Kept off the email on purpose: the price is read on the proposal page, with the scope beside it. */
  total?: number;
  discount?: number;
  validDays: number;
  link: string;
  businessName: string;
  /** Who signs it. The owner's first name, or the business when nobody's. */
  signedBy: string | null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

export function proposalReadyEmail(input: ProposalReadyInput): { subject: string; text: string } {
  const shortAddress = input.address.split(",").slice(0, 2).join(",").trim();
  const text = [
    `Hi ${firstName(input.clientName)},`,
    "",
    `Thanks for having us out to ${shortAddress}. Your proposal is ready:`,
    input.link,
    "",
    `It's good for ${input.validDays} days, and you can read it through and accept it right on that page.`,
    "",
    "Reply to this email or message us through that link with any questions.",
    "",
    "Thanks,",
    input.signedBy ? `${input.signedBy}, ${input.businessName}` : input.businessName,
  ].join("\n");
  return { subject: `Your proposal from ${input.businessName}`, text };
}
