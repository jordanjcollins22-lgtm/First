/**
 * The booking page's landing card, and what backs it up.
 *
 * Every comment the team posts says the same things: we've been featured in
 * the news, we have amazing reviews, and booking takes under five minutes and
 * shows every open time. The first thing somebody sees after tapping the link
 * has to say those things back, and show them: the story, the reviews. A claim
 * is only shown when there is something entered to back it up.
 *
 * Pure, so the rules are tested without a database.
 */

export interface ProofReview {
  id: string;
  author: string;
  body: string;
  stars: number | null;
  /** "Google", "Facebook", "Nextdoor". */
  source: string | null;
  writtenOn: string | null;
}

export interface ProofNews {
  id: string;
  outlet: string;
  headline: string;
  url: string | null;
}

/**
 * One before-and-after for the landing card: a pair shown side by side, or
 * one picture that already has both in it (a post from the social studio).
 */
export interface ShowcaseItem {
  id: string;
  title: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  imageUrl: string | null;
}

export interface BookingProof {
  reviews: ProofReview[];
  news: ProofNews[];
  /** Approved before-and-afters, cycled under "See open times". */
  showcase: ShowcaseItem[];
}

export const NO_PROOF: BookingProof = { reviews: [], news: [], showcase: [] };

/** How long each before-and-after, and each review, stays up. */
export const SHOWCASE_EVERY_MS = 4000;
export const REVIEW_EVERY_MS = 7000;

/**
 * The title for a studio post on the card: the first line of its caption,
 * up to the dash, "Mulching in Maryland 21009 —" reads as "Mulching".
 */
export function showcaseTitleFromCaption(caption: string | null | undefined, zoneName: string | null | undefined): string {
  const first = (caption ?? "").split("\n")[0].split(/\s+[—–-]\s*/)[0].trim();
  const work = first.replace(/\s+in\s+(maryland|md)\b.*$/i, "").trim();
  if (work && work.length <= 40) return work;
  return zoneName?.trim() || "A recent job";
}

/**
 * The pages a client clicks through, in order. The landing card is first, so
 * the page they arrive on says what the comment said.
 */
export const BOOKING_PAGES = ["Welcome", "Your place", "What you need", "When", "Your details"] as const;

/** One review is not "amazing reviews". Two is the least that reads as a pattern. */
export const REVIEWS_TO_CLAIM = 2;

/** How many reviews the landing card shows before "See more". */
export const REVIEWS_ON_CARD = 3;

/**
 * What the comments promise, and whether the landing card can back each one.
 *
 * The owner's preview lists these, so a claim the comments make with nothing
 * on the page behind it is on screen rather than discovered by a client.
 */
export function promisesKept(proof: BookingProof): { promise: string; kept: boolean; how: string }[] {
  const reviews = proof.reviews.length;
  return [
    {
      promise: "Featured in the news",
      kept: proof.news.length > 0,
      how: proof.news.length > 0 ? `Shows ${proof.news[0].outlet}` : "Add the news story below",
    },
    {
      promise: "Amazing reviews",
      kept: reviews >= REVIEWS_TO_CLAIM,
      how:
        reviews >= REVIEWS_TO_CLAIM
          ? `Shows ${reviews} reviews`
          : reviews === 1
            ? "Add at least one more review"
            : "Add at least two reviews below",
    },
    { promise: "Free, no obligation", kept: true, how: "Said on the card" },
    { promise: "Book in under 5 minutes, every open time", kept: true, how: "Said on the card, and the calendar shows them" },
  ];
}

/**
 * The work the person asked about, from the link they came through.
 *
 * The link's own service when it has one. Otherwise the front of the note
 * written when the link was made, "Lawn Care — Needs grass cut today", which
 * names the kind of work before the dash. Nothing when neither says.
 */
export function serviceFromLink(service: string | null | undefined, note: string | null | undefined): string | null {
  const own = service?.trim();
  if (own) return own;
  const front = (note ?? "").split(/\s+[—–-]\s+/)[0]?.trim() ?? "";
  if (!front || front === note?.trim() || front.length > 30 || /[.?!]/.test(front)) return null;
  return front;
}

/**
 * The landing card's headline. Names the work when the link says what it
 * was, in the same plain, friendly voice as the comment.
 */
export function landingHeadline(service: string | null): string {
  if (!service) return "Let's take a look at your property";
  return `Let's get your ${service.toLowerCase()} taken care of`;
}

/** The short badges under the headline: only the ones that are true. */
export function landingBadges(proof: BookingProof): string[] {
  return [
    proof.news.length > 0 ? "Featured in the news" : null,
    proof.reviews.length >= REVIEWS_TO_CLAIM ? "Amazing reviews" : null,
    "Free evaluation",
    "Book in under 5 minutes",
  ].filter((b): b is string => Boolean(b));
}
