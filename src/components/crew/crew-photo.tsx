"use client";

import { useState } from "react";

/**
 * One photo on the crew page. If it fails to load (file gone, renderer
 * refuses it), the whole tile goes away instead of showing a broken image.
 */
export function CrewPhoto({ href, src, alt, children }: { href: string; src: string; alt: string; children?: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="relative block shrink-0 snap-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className="block h-auto max-h-56 w-auto max-w-[85vw] rounded-md"
      />
      {children}
    </a>
  );
}
