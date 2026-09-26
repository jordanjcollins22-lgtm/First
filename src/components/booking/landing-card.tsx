"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Newspaper } from "lucide-react";

import { ShowcaseCarousel } from "@/components/booking/showcase-carousel";
import { landingBadges, landingHeadline, REVIEW_EVERY_MS, SHOWCASE_ASPECT, type BookingProof } from "@/lib/booking-proof";

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
 * All of it fits one screen. The card is as tall as what is on it, and on a
 * short phone the before-and-after square shrinks rather than push anything
 * off the bottom, so nobody has to scroll to see the rest.
 */
export function LandingCard({
  organizationName,
  service,
  proof,
  start,
  fitHeight = null,
}: {
  organizationName: string;
  service: string | null;
  proof: BookingProof;
  /** Where the booking starts, right under the headline: the address search. */
  start: React.ReactNode;
  /** The most the card may be, in pixels. The screen's height when not given. */
  fitHeight?: number | null;
}) {
  const badges = landingBadges(proof);
  const rootRef = useRef<HTMLDivElement>(null);
  const side = useSquareSide(rootRef, fitHeight);
  const outlets = Array.from(new Set(proof.news.map((n) => n.outlet)));
  const story = proof.news[0] ?? null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <p className="text-xs font-medium text-primary">{organizationName}</p>
        <h1 className="mt-0.5 text-xl font-bold leading-tight sm:text-2xl">{landingHeadline(service)}</h1>
      </div>

      <ul className="flex shrink-0 flex-wrap gap-1">
        {badges.map((b) => (
          <li key={b} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {b}
          </li>
        ))}
      </ul>

      <div className="shrink-0">{start}</div>

      {/* The one part that gives way on a short phone. */}
      {proof.showcase.length > 0 && <ShowcaseCarousel items={proof.showcase} side={side} />}

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

/** The page's own padding above and below the card, when it fills the screen. */
const PAGE_PADDING_PX = 24;
/** Shorter than this and a before-and-after says nothing. */
const MIN_SIDE_PX = 150;

/**
 * How tall the before-and-after can be: as tall as the card's width allows
 * for its shape, or the height left on the screen once everything else on
 * the card is counted, whichever runs out first. Measured in the browser,
 * because what else is on the card (a two-line headline, a second row of
 * badges) changes with the phone, and worked out again whenever the card or
 * the window changes size.
 */
function useSquareSide(rootRef: React.RefObject<HTMLDivElement | null>, fitHeight: number | null): number | null {
  const [px, setPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const card = root?.closest<HTMLElement>("[data-booking-card]");
    if (!root || !card) return;
    const measure = () => {
      const square = root.querySelector<HTMLElement>("[data-showcase-square]");
      if (!square?.parentElement) return;
      const tallest = square.parentElement.clientWidth / SHOWCASE_ASPECT;
      // Everything on the card that is not the picture.
      const rest = card.getBoundingClientRect().height - square.getBoundingClientRect().height;
      const limit = fitHeight ?? window.innerHeight - PAGE_PADDING_PX;
      const next = Math.max(MIN_SIDE_PX, Math.floor(Math.min(tallest, limit - rest)));
      setPx((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rootRef, fitHeight]);

  return px;
}

/** One review at a time, fading from one to the next, in a box that never changes size. */
function RotatingReview({ reviews }: { reviews: BookingProof["reviews"] }) {
  const [at, setAt] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (reviews.length < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      // Out, change, back in.
      setVisible(false);
      swap = setTimeout(() => {
        setAt((i) => (i + 1) % reviews.length);
        setVisible(true);
      }, 300);
    }, REVIEW_EVERY_MS);
    return () => {
      clearInterval(timer);
      if (swap) clearTimeout(swap);
    };
  }, [reviews.length]);
  const r = reviews[at % reviews.length];
  const initial = r.author.trim().charAt(0).toUpperCase() || "?";

  return (
    // Left off the very shortest screens, where it would leave the
    // before-and-after too small to see.
    <figure className="relative shrink-0 overflow-hidden rounded-xl bg-primary/5 px-4 pb-3 pt-3 [@media(max-height:600px)]:hidden">
      {/* A large quote mark, set behind the words. */}
      <span aria-hidden className="pointer-events-none absolute -top-3 left-2 font-serif text-6xl leading-none text-primary/15">
        &ldquo;
      </span>
      <div className={`relative transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}>
        {/* Two lines, always, so the card never moves when the review changes. */}
        <blockquote className="line-clamp-2 min-h-[2.5rem] text-sm italic leading-5 text-foreground/90">{r.body}</blockquote>
        <figcaption className="mt-2 flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >
            {initial}
          </span>
          <span className="min-w-0 truncate pr-10 text-xs">
            <span className="font-semibold">{r.author}</span>
            {r.source && <span className="text-muted-foreground"> · {r.source} review</span>}
          </span>
        </figcaption>
      </div>
      {reviews.length > 1 && (
        <span className="absolute bottom-[22px] right-4 flex gap-1" aria-hidden>
          {reviews.map((review, i) => (
            <span key={review.id} className={`h-1 w-1 rounded-full ${i === at % reviews.length ? "bg-primary" : "bg-primary/25"}`} />
          ))}
        </span>
      )}
    </figure>
  );
}
