"use client";

import { useEffect, useState } from "react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
import { PREVIEW } from "@/lib/storage-image-url";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

/** Re-renders the property photo with the drawn work-area outlines on top —
 * used by both the client's proposal and the crew's work order, so the two
 * cannot drift into disagreeing about where a zone is.
 *
 * same transform math the live canvas board uses (translate, then rotate,
 * then draw the image centered at its natural size x scale). Zone points are
 * already in that same fixed canvas coordinate space, so they just draw
 * as-is on top, no further transform needed. */
export function SiteMapImage({
  imagePath,
  transform,
  zones,
  frame,
  numbered = false,
  dimSurroundings = false,
  className,
}: {
  imagePath: string;
  transform: ProposalSiteImageTransform;
  /** Only the three fields the map draws with — narrowed so a caller with
   * shapes but no scope text can pass what it has. */
  zones: Pick<ProposalZoneSnapshot, "zoneName" | "color" | "points">[];
  /** Crop the view to a region of the canvas instead of showing all of it.
   * Placement of the photo is independent of this, so cropping is safe. */
  frame?: { x: number; y: number; width: number; height: number };
  /** Number each zone on the map, to match a numbered list beside it. */
  numbered?: boolean;
  /** Darken everything outside the zones. Turns a tinted shape on a busy
   * satellite photo into the only lit part of the picture, which is what a
   * crew need glancing at a phone in sunlight. */
  dimSurroundings?: boolean;
  className?: string;
}) {
  // The site map is displayed at page width, never at the resolution it was
  // captured at. PREVIEW is 1280px wide, which is more than any phone shows
  // and a fraction of the original's weight.
  //
  // Falls back to the original if the resize does not come back: asking for a
  // resized copy routes through Supabase's image renderer, which is not on
  // for every project, and a sent proposal missing its site map is worse than
  // a heavy one.
  const [fullSize, setFullSize] = useState(false);
  const url = fullSize ? canvasImageUrl(imagePath) : canvasImageUrl(imagePath, PREVIEW);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    // Without this the skeleton below stays up forever when the resized copy
    // does not come back, because nothing else ever sets a natural size. A
    // sent proposal stuck on a shimmer is the worst version of this failing.
    img.onerror = () => {
      if (!cancelled) setFullSize((was) => was || true);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  const zonesWithOutlines = zones.filter((z) => z.points.length >= 2);

  if (!naturalSize) {
    return (
      <div
        className="w-full animate-pulse rounded-2xl border border-border bg-muted"
        style={{ aspectRatio: `${transform.canvasWidth} / ${transform.canvasHeight}` }}
      />
    );
  }

  const w = naturalSize.w * transform.scale;
  const h = naturalSize.h * transform.scale;

  const view = frame ?? {
    x: 0,
    y: 0,
    width: transform.canvasWidth,
    height: transform.canvasHeight,
  };

  // Stroke and marker sizes are a fraction of the frame rather than fixed
  // numbers, so a zone looks the same on screen whether the view is the whole
  // canvas or cropped tight around the work. A fixed 3px was sub-pixel on a
  // phone in the full view and heavy in the cropped one.
  const unit = Math.max(view.width, view.height);
  const casingWidth = unit * 0.014;
  const strokeWidth = unit * 0.006;
  const markerRadius = unit * 0.035;
  const markerFont = unit * 0.042;
  const maskId = `zone-mask-${imagePath.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={
          frame
            ? `${frame.x} ${frame.y} ${frame.width} ${frame.height}`
            : `0 0 ${transform.canvasWidth} ${transform.canvasHeight}`
        }
        className={className ?? "w-full rounded-2xl border border-border bg-muted"}
      >
        {dimSurroundings && (
          <defs>
            <mask id={maskId}>
              <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="white" />
              {zonesWithOutlines.map((zone, i) => (
                <polygon key={i} points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="black" />
              ))}
            </mask>
          </defs>
        )}

        <g transform={`translate(${transform.x} ${transform.y}) rotate(${transform.rotation})`}>
          <image href={url} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" />
        </g>

        {dimSurroundings && (
          <rect
            x={view.x}
            y={view.y}
            width={view.width}
            height={view.height}
            fill="#0b1f14"
            opacity={0.55}
            mask={`url(#${maskId})`}
          />
        )}
        {zonesWithOutlines.map((zone, i) => {
          const centre = zone.points.reduce(
            (acc, p) => ({ x: acc.x + p.x / zone.points.length, y: acc.y + p.y / zone.points.length }),
            { x: 0, y: 0 }
          );
          return (
            <g key={i}>
              {/* A white casing under the coloured line, the way a route is
                  drawn on a map. Satellite imagery is busy and unpredictable,
                  and a single stroke disappears into whatever is beneath it —
                  a green zone on grass worst of all. White separates the line
                  from the photo whatever colour either happens to be, which a
                  dark casing cannot do under a dark zone. */}
              <polygon
                points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.9}
                strokeWidth={casingWidth}
                strokeLinejoin="round"
              />
              <polygon
                points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={zone.color}
                fillOpacity={0.28}
                stroke={zone.color}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
              />
              {numbered && (
                <>
                  <circle
                    cx={centre.x}
                    cy={centre.y}
                    r={markerRadius}
                    fill="#ffffff"
                    stroke="#0b1f14"
                    strokeWidth={strokeWidth}
                  />
                  <text
                    x={centre.x}
                    y={centre.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={markerFont}
                    fontWeight="bold"
                    fill="#0b1f14"
                  >
                    {i + 1}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {!numbered && zonesWithOutlines.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {zonesWithOutlines.map((zone, i) => (
            <span key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} aria-hidden />
              {zone.zoneName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
