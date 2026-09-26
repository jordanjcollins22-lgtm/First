"use client";

import { useState } from "react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
import type { ImageTransform } from "@/lib/storage-image-url";

/**
 * A job photo at the size it is actually displayed, with the original as a
 * safety net.
 *
 * Asking for a resized copy routes through Supabase's image renderer, which
 * is not switched on for every project. Where it is off, the resized URL
 * returns nothing — and on a proposal already sent to a client, a page of
 * broken images is far worse than a page of heavy ones.
 *
 * So the first attempt is the small version and the fallback is the original.
 * Where the renderer is on, a client on mobile data downloads a few hundred
 * kilobytes instead of several megabytes. Where it is off, they get exactly
 * what they got before. Neither case can fail.
 */
export function ResizedImage({
  path,
  transform,
  alt,
  /**
   * Shape of the tile, as a Tailwind aspect class. The photo is fitted inside
   * it whole.
   *
   * Square, because these are photos taken on a phone standing in somebody's
   * garden and nearly all of them are portrait. Fitting a portrait photo
   * inside a landscape tile leaves it small between two wide grey margins;
   * the same photo in a square tile is close to twice the size, and a
   * landscape one still fits with room to spare.
   */
  aspect = "aspect-square",
  className,
}: {
  path: string;
  transform: ImageTransform;
  alt: string;
  aspect?: string;
  className?: string;
}) {
  const [full, setFull] = useState(false);

  return (
    // The box, not the photo, decides the shape.
    //
    // The photo used to be the box: an <img> with an aspect class and no
    // width of its own takes its width from its intrinsic size, and a lazy
    // image that has not loaded yet has no intrinsic size at all. It
    // collapses to the width of its own alt text, which wraps -- so a
    // proposal full of photos below the fold rendered as a row of tall thin
    // slivers until each one happened to load.
    //
    // A wrapper with a fixed shape cannot do that. It is the right size
    // before the photo exists, while it loads, and if it never arrives.
    <div className={`${aspect} overflow-hidden rounded-lg bg-muted ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={full ? canvasImageUrl(path) : canvasImageUrl(path, transform)}
        alt={alt}
        loading="lazy"
        decoding="async"
        // Once, and only from the resized version. Retrying the original
        // after the original failed would loop on a photo that is genuinely
        // gone.
        onError={() => setFull((was) => was || true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
