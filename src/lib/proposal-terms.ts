/**
 * The terms every client sees before they accept.
 *
 * These exist because of a specific, repeated problem: work gets added on the
 * day. Somebody meets the crew in the driveway, points at something that was
 * never quoted, and asks them to "just do this bit too". The crew, who are
 * there to be helpful and have no authority to price anything, do it. The job
 * runs long, the margin goes, and nobody has a record of why.
 *
 * So the rule is stated in writing, in front of the client, at the one moment
 * they are paying attention to it: the screen where they accept. Changes go in
 * before acceptance, when the price can still move. After that, new work is a
 * new visit, documented and quoted on its own.
 *
 * The third point is the one that actually stops it happening. The first two
 * are the policy; naming the crew as unable to authorise work takes the
 * decision off the person standing in the yard who cannot say no comfortably.
 * The fourth sets an expectation nobody can control, so that a rained-out
 * Tuesday is a thing that was always going to be possible rather than a thing
 * that went wrong.
 *
 * Written plainly and warmly, with no dashes, because a client reads this
 * paragraph in the ten seconds before they commit money and it should sound
 * like a person rather than a contract.
 *
 * One constant rather than prose typed into a component, so the client page,
 * the internal preview and anything added later cannot end up quoting
 * different terms at different people.
 */

export interface ProposalTerm {
  heading: string;
  body: string;
}

export const PROPOSAL_TERMS: ProposalTerm[] = [
  {
    heading: "Tell us about any changes before you sign",
    body:
      "Everything we plan to do is written out above. If something is missing, or you would " +
      "like work added, changed or taken off, just say so before you accept. We will update " +
      "this proposal and send it straight back to you, with the new price on it.",
  },
  {
    heading: "After you sign, anything new becomes its own visit",
    body:
      "Accepting sets both the work and the price. If you think of something else later, that " +
      "is no problem at all. We will write it up, price it, and book it as a separate visit so " +
      "you always know what you are paying for.",
  },
  {
    heading: "Our crew cannot add work while they are there",
    body:
      "They are on site to do what is on this proposal, and they are not able to price or " +
      "approve anything beyond it. Please give us a call instead and we will get you a price " +
      "for it the same day wherever we can.",
  },
  {
    heading: "Our schedule moves with the weather",
    body:
      "We work outdoors, so heavy rain and frozen ground can push a day back. If yours has to " +
      "move we will let you know as soon as we do, and you keep your place at the front of the " +
      "schedule rather than going back to the end of it.",
  },
];

export const PROPOSAL_TERMS_TITLE = "Before you accept";

/** Once they have answered, the same words are a record rather than a warning,
 * so the heading stops telling them to do something they have already done. */
export const PROPOSAL_TERMS_TITLE_AGREED = "How changes and scheduling work";

/** Shown next to the accept button, so agreeing to the work and agreeing to
 * how changes are handled are the same action. */
export const PROPOSAL_ACCEPT_NOTE =
  "Accepting confirms the work above is complete and correct, and that anything added later " +
  "will be priced and booked as its own visit.";
