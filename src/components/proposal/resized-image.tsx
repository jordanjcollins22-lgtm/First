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
  className,
}: {
  path: string;
  transform: ImageTransform;
  alt: string;
  className?: string;
}) {
  const [full, setFull] = useState(false);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={full ? canvasImageUrl(path) : canvasImageUrl(path, transform)}
      alt={alt}
      loading="lazy"
      decoding="async"
      // Once, and only from the resized version. Retrying the original after
      // the original failed would loop on a photo that is genuinely gone.
      onError={() => setFull((was) => was || true)}
      className={className}
    />
  );
}
