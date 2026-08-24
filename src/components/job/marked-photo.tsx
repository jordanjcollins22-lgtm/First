"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
import type { Point } from "@/components/canvas/types";

/**
 * A photo from the evaluation with the evaluator's pins on it.
 *
 * The pins are the point. "Re-edge the bed" is an instruction; the same photo
 * with a pin on the corner that has collapsed is the instruction plus the
 * answer to the question the crew were otherwise going to ring about.
 *
 * Markers are stored as fractions of the image, so they are positioned as
 * percentages here — the same pin lands in the same place on the evaluator's
 * tablet, the crew's phone, and the full-screen view, without anybody
 * recomputing anything.
 */
export function MarkedPhoto({
  path,
  markers,
  alt,
  onOpen,
}: {
  path: string;
  markers: Point[];
  alt: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block w-full overflow-hidden rounded-lg border border-border"
    >
      {/* Natural aspect, never object-cover. Cropping to a square grid makes
          the picture tidier and the pins wrong: a marker is a fraction of the
          image, and once the image is cropped, a fraction of the container is
          somewhere else entirely. Ragged heights are a fair price for a pin
          that is on the corner it was dropped on. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={canvasImageUrl(path)} alt={alt} className="block w-full" />
      {markers.map((marker, index) => (
        <span
          key={index}
          style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-[9px] font-bold text-white shadow-md"
        >
          {index + 1}
        </span>
      ))}
      {markers.length > 0 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-white">
          {markers.length} marked
        </span>
      )}
    </button>
  );
}

/**
 * The zone's photos, tappable to fill the screen.
 *
 * A thumbnail is enough to know a photo exists and roughly what it shows; it
 * is not enough to see which corner of a bed a pin is on, which is the whole
 * reason the pin was dropped. So one tap opens it as large as the phone goes,
 * pins and all.
 */
export function ZonePhotos({
  photos,
  zoneName,
}: {
  photos: { path: string; markers: Point[] }[];
  zoneName: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;

  const open = openIndex != null ? photos[openIndex] : null;

  return (
    <div className="mb-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Photos from the evaluation
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {photos.map((photo, index) => (
          <MarkedPhoto
            key={photo.path}
            path={photo.path}
            markers={photo.markers}
            alt={`${zoneName} photo ${index + 1}`}
            onOpen={() => setOpenIndex(index)}
          />
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3"
          role="dialog"
          aria-label={`${zoneName} photo`}
          onClick={() => setOpenIndex(null)}
        >
          <div className="flex items-center justify-between text-white">
            <span className="text-sm font-semibold">{zoneName}</span>
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative m-auto w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={canvasImageUrl(open.path)} alt="" className="w-full rounded-lg" />
            {open.markers.map((marker, index) => (
              <span
                key={index}
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-destructive text-xs font-bold text-white shadow-lg"
              >
                {index + 1}
              </span>
            ))}
          </div>

          {photos.length > 1 && (
            <div className="flex justify-center gap-2 pb-2">
              {photos.map((photo, index) => (
                <button
                  key={photo.path}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenIndex(index);
                  }}
                  className={`h-2.5 w-2.5 rounded-full ${index === openIndex ? "bg-white" : "bg-white/40"}`}
                  aria-label={`Photo ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
