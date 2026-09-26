"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Newspaper, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ShowcaseCarousel } from "@/components/booking/showcase-carousel";
import { landingBadges, landingHeadline, REVIEW_EVERY_MS, type BookingProof } from "@/lib/booking-proof";

/**
 * The first page of the booking card: what the comment said, shown.
 *
 * The comment told them we've been in the news, have amazing reviews, and
 * that booking takes under five minutes and shows every open time. So this
 * says the same, in the same voice, names the work they asked about, and
 * shows it: the business's before-and-afters cycling under the button, the
 * news it was in, and one review at a time. Anything with nothing entered
 * behind it is left off rather than claimed.
 *
 * All of it fits one screen. The before-and-afters take whatever height is
 * left, so on a short phone they shrink rather than push anything off the
 * bottom, and nobody has to scroll to see the rest.
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
  const badges = landingBadges(proof);
  const outlets = Array.from(new Set(proof.news.map((n) => n.outlet)));
  const story = proof.news[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <p className="text-xs font-medium text-primary">{organizationName}</p>
        <h1 className="mt-0.5 text-xl font-bold leading-tight sm:text-2xl">{landingHeadline(service)}</h1>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          A free evaluation, then a written proposal with a fixed price. Booking takes under 5 minutes and shows every open
          time.
        </p>
      </div>

      <ul className="flex shrink-0 flex-wrap gap-1">
        {badges.map((b) => (
          <li key={b} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {b}
          </li>
        ))}
      </ul>

      <Button type="button" className="h-12 w-full shrink-0 text-base" onClick={onStart}>
        See open times <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>

      {proof.showcase.length > 0 ? (
        <ShowcaseCarousel items={proof.showcase} className="min-h-[7rem] flex-1" />
      ) : (
        <div className="flex-1" />
      )}

      {story && (
        <a
          href={story.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`flex shrink-0 items-center gap-2 text-xs ${story.url ? "hover:underline" : "pointer-events-none"}`}
        >
          <Newspaper className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 truncate">
            <span className="font-semibold">As seen on </span>
            {outlets.join(", ")}
          </span>
        </a>
      )}

      {proof.reviews.length > 0 && <RotatingReview reviews={proof.reviews} />}
    </div>
  );
}

/** One review at a time, changing on its own, in a box that never changes size. */
function RotatingReview({ reviews }: { reviews: BookingProof["reviews"] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (reviews.length < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setAt((i) => (i + 1) % reviews.length), REVIEW_EVERY_MS);
    return () => clearInterval(timer);
  }, [reviews.length]);
  const r = reviews[at % reviews.length];

  return (
    <figure className="shrink-0 rounded-xl border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        {r.stars === 5 ? (
          <span className="flex gap-0.5" aria-label="5 out of 5 stars">
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
            ))}
          </span>
        ) : (
          // A Facebook recommendation has no stars; it says so instead.
          <span className="text-[11px] font-semibold text-primary">Recommends</span>
        )}
        <figcaption className="truncate text-[11px] text-muted-foreground">
          {r.author}
          {r.source ? `, ${r.source}` : ""}
        </figcaption>
      </div>
      {/* Two lines, always, so the card never moves when the review changes. */}
      <blockquote className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-5">&ldquo;{r.body}&rdquo;</blockquote>
    </figure>
  );
}
