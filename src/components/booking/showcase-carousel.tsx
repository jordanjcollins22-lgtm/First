"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { SHOWCASE_ASPECT, SHOWCASE_EVERY_MS, type ShowcaseItem } from "@/lib/booking-proof";

/**
 * The business's work, one before-and-after at a time, changing on its own.
 *
 * Each is a finished picture from Before & After Posts, 1080 by 1350 with
 * its own Before and After labels on it, so it is shown whole and in its own
 * shape: never cropped, never padded out with filler. It is as big as the
 * card allows and shrinks on a short phone, so the landing card still fits
 * one screen. The job's name and the dots sit under it, not over it.
 *
 * Only the one on show and its neighbours are loaded, resized for a phone.
 * A tap moves it on; somebody who asked for less motion gets no timer.
 */
export function ShowcaseCarousel({
  items,
  side,
  className,
}: {
  items: ShowcaseItem[];
  /** The picture's height in pixels, worked out by the card; full width until then. */
  side?: number | null;
  className?: string;
}) {
  const [at, setAt] = useState(0);
  const count = items.length;

  useEffect(() => {
    if (count < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setAt((i) => (i + 1) % count), SHOWCASE_EVERY_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (count === 0) return null;
  const current = at % count;
  const next = (current + 1) % count;
  // The one just shown stays mounted to fade out under the new one.
  const previous = (current - 1 + count) % count;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex justify-center">
        <button
          type="button"
          data-showcase-square
          onClick={() => setAt((i) => (i + 1) % count)}
          style={side ? { width: Math.round(side * SHOWCASE_ASPECT), height: side } : undefined}
          className={cn("relative shrink-0 overflow-hidden rounded-xl bg-muted shadow-sm", !side && "aspect-[4/5] w-full")}
          aria-label={`Before and after: ${items[current].title}.${count > 1 ? " Tap for the next one." : ""}`}
        >
          {items.map((item, i) =>
            i === current || i === next || i === previous ? (
              <span
                key={item.id}
                className={cn("absolute inset-0 transition-opacity duration-700", i === current ? "opacity-100" : "opacity-0")}
              >
                <Image
                  src={item.imageUrl}
                  alt={`${item.title}, before and after`}
                  fill
                  sizes="(max-width: 480px) 100vw, 448px"
                  className="object-cover"
                  priority={i === 0}
                />
              </span>
            ) : null
          )}
        </button>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
        <span className="truncate text-xs font-medium text-muted-foreground">{items[current].title}</span>
        {count > 1 && (
          <span className="flex shrink-0 gap-1" aria-hidden>
            {items.map((item, i) => (
              <span key={item.id} className={cn("h-1.5 w-1.5 rounded-full", i === current ? "bg-primary" : "bg-muted-foreground/30")} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
