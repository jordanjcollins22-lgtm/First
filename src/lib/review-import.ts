import { z } from "zod/v4";

/**
 * Reviews pulled from the business's own pages, for the booking page.
 *
 * The owner pastes the Facebook page and the Google listing. The Chrome
 * extension, signed in as them, opens each one's reviews and sends back what
 * the page says; the model picks the reviews out of it; and only the
 * five-star ones with something written are kept. A bad review never goes
 * on the page, and neither does a star rating with no words, which proves
 * nothing to somebody deciding whether to book.
 *
 * Pure, so the rules are tested without a browser or a model.
 */

export type ReviewPlatform = "facebook" | "google";

export const PLATFORM_LABEL: Record<ReviewPlatform, string> = { facebook: "Facebook", google: "Google" };

/** Looked at again this often, so new reviews arrive without anybody asking. */
export const PULL_EVERY_DAYS = 7;

export type SourceCheck =
  | { ok: true; platform: ReviewPlatform; url: string; reviewsUrl: string }
  | { ok: false; error: string };

/**
 * What a pasted link is, and where its reviews are.
 *
 * A Facebook page's reviews are on its Reviews tab, so the page link is
 * turned into that. A Google link is opened as it is, and the extension
 * presses the listing's own Reviews tab.
 */
export function reviewSourceFrom(raw: string): SourceCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Paste a link." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: "That doesn't look like a link." };
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|web|business)\./, "");

  if (/(^|\.)instagram\.com$/.test(host)) {
    return { ok: false, error: "Instagram doesn't have reviews to pull. Add your Facebook page and your Google listing." };
  }

  if (host === "facebook.com" || host === "fb.com") {
    const id = url.searchParams.get("id");
    if (url.pathname.replace(/\/+$/, "") === "/profile.php" && id && /^\d+$/.test(id)) {
      const page = `https://www.facebook.com/profile.php?id=${id}`;
      return { ok: true, platform: "facebook", url: page, reviewsUrl: `${page}&sk=reviews` };
    }
    const slug = url.pathname.split("/").filter(Boolean)[0];
    if (!slug || ["groups", "share", "watch", "events", "marketplace", "search", "photo", "photos", "story.php", "permalink.php"].includes(slug.toLowerCase())) {
      return { ok: false, error: "Paste the link to your Facebook page itself, like facebook.com/yourbusiness." };
    }
    const page = `https://www.facebook.com/${slug}`;
    return { ok: true, platform: "facebook", url: page, reviewsUrl: `${page}/reviews` };
  }

  const googleMaps =
    ((host === "google.com" || /^google\.[a-z.]+$/.test(host)) && url.pathname.startsWith("/maps")) ||
    host === "maps.google.com" ||
    host === "maps.app.goo.gl" ||
    (host === "goo.gl" && url.pathname.startsWith("/maps")) ||
    host === "g.page" ||
    host === "share.google" ||
    (host === "google.com" && url.searchParams.has("cid"));
  if (googleMaps) {
    const clean = url.toString();
    return { ok: true, platform: "google", url: clean, reviewsUrl: clean };
  }
  if (host === "google.com" || /^google\.[a-z.]+$/.test(host)) {
    return {
      ok: false,
      error: "Use your Google Maps link: open your business on Google Maps, press Share, and paste that link.",
    };
  }
  return { ok: false, error: "Only Facebook page and Google Maps links have reviews to pull." };
}

/** One review as the model read it off the page. */
export const ReadReviewSchema = z.object({
  author: z.string(),
  text: z.string(),
  /** 1 to 5 when the page showed stars; null when it did not. */
  stars: z.number().int().min(1).max(5).nullable(),
  /** Facebook's "recommends" or "doesn't recommend"; null when the page didn't say. */
  recommends: z.boolean().nullable(),
  /** As the page said it: "2 months ago", "March 3, 2026". */
  when: z.string().nullable(),
});

export const ReadReviewsSchema = z.object({ reviews: z.array(ReadReviewSchema) });

export type ReadReview = z.infer<typeof ReadReviewSchema>;

export const REVIEW_READ_SYSTEM_PROMPT = [
  "You read the reviews section of a local business's Facebook page or Google Maps listing, given as the page's text.",
  "Star ratings appear in the text as bracketed labels such as [Rated 5.0 out of 5], [5 stars] or [4 stars].",
  "",
  "Return every customer review on the page, each once:",
  "- author: the reviewer's name exactly as shown.",
  "- text: what they wrote, word for word, joined into one paragraph. Leave out buttons and labels such as Like, Reply, More, Share, Helpful, and any reply from the owner.",
  "- stars: the reviewer's own star rating as a number from 1 to 5, or null if the page shows none for this review. Never use the business's overall rating.",
  "- recommends: true if Facebook says they recommend the business, false if it says they don't, null otherwise.",
  "- when: the date or age shown for the review, or null.",
  "",
  "Never invent, summarize, correct or complete a review. If the page has no reviews, return an empty list.",
].join("\n");

/**
 * Whether a review may go on the booking page.
 *
 * Five stars and something written. A Facebook recommendation has no stars
 * since Facebook stopped using them; "recommends" is its best rating, so it
 * counts, and "doesn't recommend" never does.
 */
export function keepReview(platform: ReviewPlatform, review: ReadReview): boolean {
  if (review.text.trim().split(/\s+/).length < 3) return false;
  if (review.recommends === false) return false;
  if (review.stars != null) return review.stars === 5;
  return platform === "facebook" && review.recommends === true;
}

function squash(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The same review, however it was read: which platform, who, and how it
 * starts. Used to skip one already kept, and one the owner deleted.
 */
export function reviewKey(platform: ReviewPlatform, review: Pick<ReadReview, "author" | "text">): string {
  return `${platform}:${squash(review.author).slice(0, 40)}:${squash(review.text).slice(0, 80)}`;
}

/**
 * Whether a source is due a look: asked for since the last one, never
 * looked at, or not looked at for a week.
 */
export function pullDue(source: { pullRequestedAt: string | null; pulledAt: string | null }, now: Date): boolean {
  if (!source.pulledAt) return true;
  if (source.pullRequestedAt && source.pullRequestedAt > source.pulledAt) return true;
  return now.getTime() - new Date(source.pulledAt).getTime() >= PULL_EVERY_DAYS * 86_400_000;
}

/** "Found 14 reviews, 9 five-star with words, 6 new." */
export function describePull(found: number, fiveStar: number, added: number): string {
  if (found === 0) return "No reviews found on the page. Check the link opens your reviews, and that you're signed in.";
  return `Found ${found} review${found === 1 ? "" : "s"}, ${fiveStar} five-star with something written, ${added} new.`;
}
