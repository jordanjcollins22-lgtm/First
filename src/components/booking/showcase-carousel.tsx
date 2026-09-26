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
  const fade = cn("absolute inset-0 transition-opacity duration-700", shown ? "opacity-100" : "opacity-0");
  if (item.beforeUrl && item.afterUrl) {
    return (
      <span className={cn(fade, "flex gap-0.5")}>
        <Half src={item.beforeUrl} label="Before" alt={`${item.title}, before`} eager={eager} />
        <Half src={item.afterUrl} label="After" alt={`${item.title}, after`} eager={eager} />
      </span>
    );
  }
  if (!item.imageUrl) return null;
  return (
    <span className={fade}>
      <Image src={item.imageUrl} alt={`${item.title}, before and after`} fill sizes="(max-width: 480px) 100vw, 448px" className="object-cover" priority={eager} />
    </span>
  );
}

function Half({ src, label, alt, eager }: { src: string; label: string; alt: string; eager: boolean }) {
  return (
    <span className="relative h-full w-1/2">
      <Image src={src} alt={alt} fill sizes="(max-width: 480px) 50vw, 224px" className="object-cover" priority={eager} />
      <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
        {label}
      </span>
    </span>
  );
}
