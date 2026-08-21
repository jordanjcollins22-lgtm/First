/**
 * The terms every client sees before they accept.
 *
 * These exist because of a specific, repeated problem: work gets added on the
 * day. Somebody meets the crew in the driveway, points at something that was
 * never quoted, and asks them to "just do this bit too" — and the crew, who
 * are there to be helpful and have no authority to price anything, do it. The
 * job runs long, the margin goes, and nobody has a record of why.
 *
 * So the rule is stated in writing, in front of the client, at the one moment
 * they are paying attention to it: the screen where they accept. Changes go in
 * before acceptance, when the price can still move. After that, new work is a
 * new visit, documented and quoted on its own.
 *
 * The third point is the one that actually stops it happening. The first two
 * are the policy; naming the crew as unable to authorise work takes the
 * decision off the person standing in the yard who cannot say no comfortably.
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
    heading: "Changes to the scope happen now, not later",
    body:
      "Everything we plan to do is listed above. If something is missing, or you would like " +
      "work added, changed or removed, tell us before you accept — we will update this proposal " +
      "and send it back to you.",
  },
  {
    heading: "Anything added afterwards is a separate visit",
    body:
      "Once this proposal is accepted, the scope above is what is booked and what is priced. " +
      "Work that is not in it gets written up, quoted and scheduled as its own visit rather than " +
      "added to this one.",
  },
  {
    heading: "Our crew cannot add work on the day",
    body:
      "They are there to carry out what is on this proposal, and they are not able to price or " +
      "authorise anything else. If you would like something more done, contact us and we will get " +
      "you a price for it.",
  },
];

export const PROPOSAL_TERMS_TITLE = "Before you accept";

/** Once they have answered, the same words are a record rather than a warning,
 * so the heading stops telling them to do something they have already done. */
export const PROPOSAL_TERMS_TITLE_AGREED = "How changes to the scope work";

/** Shown next to the accept button, so agreeing to the work and agreeing to
 * how changes are handled are the same action. */
export const PROPOSAL_ACCEPT_NOTE =
  "Accepting confirms the scope above is complete and correct, and that any work added later " +
  "will be quoted and scheduled separately.";
