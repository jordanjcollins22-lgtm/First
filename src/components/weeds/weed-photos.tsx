"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface ShownPhoto {
  id: string;
  url: string;
  caption: string | null;
  credit: string | null;
}

/**
 * The photos, one at a time.
 *
 * The first is the one that went on paper, so somebody who has just scanned
 * the sheet sees the picture they are holding before anything else, and then
 * swaps to the others. A weed with one photo gets no controls rather than
 * arrows that do nothing.
 */
export function WeedPhotos({ photos, name }: { photos: ShownPhoto[]; name: string }) {
  const [at, setAt] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No photo of this one yet.
      </div>
    );
  }

  const photo = photos[Math.min(at, photos.length - 1)];
  const step = (by: number) => setAt((i) => (i + by + photos.length) % photos.length);

  return (
    <figure>
      <div className="relative overflow-hidden rounded-lg border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={name} className="aspect-[4/3] w-full object-cover" />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => step(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => step(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
              {Math.min(at, photos.length - 1) + 1} of {photos.length}
            </span>
          </>
        )}
      </div>
      {(photo.caption || photo.credit) && (
        <figcaption className="mt-1.5 text-xs text-muted-foreground">
          {photo.caption}
          {photo.caption && photo.credit ? " · " : ""}
          {photo.credit}
        </figcaption>
      )}
    </figure>
  );
}
