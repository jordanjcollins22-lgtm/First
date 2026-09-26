"use client";

import { useState } from "react";
import { ArrowRight, Newspaper, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { landingBadges, landingHeadline, REVIEWS_ON_CARD, type BookingProof } from "@/lib/booking-proof";

/**
 * The first page of the booking card: what the comment said, shown.
 *
 * The comment told them we've been in the news, have amazing reviews, and
 * that booking takes under five minutes and shows every open time. So this
 * says the same, in the same voice, names the work they asked about, and
 * puts the story and the reviews right under it. Anything with nothing
 * entered behind it is left off rather than claimed.
 */
export function LandingCard({
  organizationName,
  service,
  proof,
  onStart,
}: {
  organizationName: string;
  service: string | null;
  proof: BookingProof;
  onStart: () => void;
}) {
  const [allReviews, setAllReviews] = useState(false);
  const badges = landingBadges(proof);
  const reviews = allReviews ? proof.reviews : proof.reviews.slice(0, REVIEWS_ON_CARD);
  const story = proof.news[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-primary">{organizationName}</p>
        <h1 className="mt-0.5 text-2xl font-bold leading-tight">{landingHeadline(service)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Book a free evaluation and we&apos;ll walk the property with you, then send a written proposal with a fixed
          price. It takes under 5 minutes and shows every open date and time, so you can pick what works for you.
        </p>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <li key={b} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {b}
          </li>
        ))}
      </ul>

      <Button type="button" className="h-12 w-full text-base" onClick={onStart}>
        See open times <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>

      {story && (
        <a
          href={story.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`flex gap-3 rounded-xl border border-border bg-background p-3 ${story.url ? "hover:bg-accent/50" : "pointer-events-none"}`}
        >
          <Newspaper className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">As seen on {story.outlet}</span>
            <span className="block text-sm font-medium">{story.headline}</span>
            {story.url && <span className="mt-0.5 block text-xs text-primary">Watch the story</span>}
          </span>
        </a>
      )}

      {reviews.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">What our clients say</p>
          {reviews.map((r) => (
            <figure key={r.id} className="rounded-xl border border-border bg-background p-3">
              {r.stars != null && (
                <div className="mb-1 flex gap-0.5" aria-label={`${r.stars} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className={`h-3.5 w-3.5 ${i < r.stars! ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
              )}
              <blockquote className="text-sm">&ldquo;{r.body}&rdquo;</blockquote>
              <figcaption className="mt-1 text-xs text-muted-foreground">
                {r.author}
                {r.source ? `, on ${r.source}` : ""}
              </figcaption>
            </figure>
          ))}
          {!allReviews && proof.reviews.length > REVIEWS_ON_CARD && (
            <button type="button" onClick={() => setAllReviews(true)} className="self-start py-1 text-sm font-medium text-primary underline">
              See all {proof.reviews.length} reviews
            </button>
          )}
          {/* Said again under the reviews, for whoever read them all. */}
          <Button type="button" className="mt-1 h-12 w-full text-base" onClick={onStart}>
            Book my free evaluation <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
