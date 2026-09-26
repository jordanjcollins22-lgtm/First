"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { SHOWCASE_EVERY_MS, type ShowcaseItem } from "@/lib/booking-proof";

/**
 * The business's work, one before-and-after at a time, changing on its own.
 *
 * It fills whatever height the card leaves it, so the landing card fits one
 * screen with nothing to scroll. Only the one on show and its neighbours
 * are loaded, all resized for a phone, so cycling costs little.
 * A tap moves it on; somebody who asked for less motion gets no timer.
 */
export function ShowcaseCarousel({ items, className }: { items: ShowcaseItem[]; className?: string }) {
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
    <button
      type="button"
      onClick={() => setAt((i) => (i + 1) % count)}
      className={cn("relative block w-full overflow-hidden rounded-xl bg-muted text-left", className)}
      aria-label={`Before and after: ${items[current].title}. Tap for the next one.`}
    >
      {items.map((item, i) =>
        i === current || i === next || i === previous ? (
          <Slide key={item.id} item={item} shown={i === current} eager={i === 0} />
        ) : null
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <span className="truncate text-sm font-semibold text-white">{items[current].title}</span>
        {count > 1 && (
          <span className="flex shrink-0 gap-1" aria-hidden>
            {items.map((item, i) => (
              <span key={item.id} className={cn("h-1.5 w-1.5 rounded-full", i === current ? "bg-white" : "bg-white/40")} />
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

function Slide({ item, shown, eager }: { item: ShowcaseItem; shown: boolean; eager: boolean }) {
  return (
    <span className={cn("absolute inset-0 transition-opacity duration-700", shown ? "opacity-100" : "opacity-0")}>
      {/* The studio's square has the before above the after, so it is shown
          whole rather than cropped to the box, which would cut one of them
          off. The same picture, blurred, fills the sides instead of grey. */}
      <Image src={item.imageUrl} alt="" aria-hidden fill sizes="64px" className="scale-110 object-cover opacity-60 blur-xl" />
      <Image src={item.imageUrl} alt={`${item.title}, before and after`} fill sizes="(max-width: 480px) 100vw, 448px" className="object-contain" priority={eager} />
    </span>
  );
}
