"use client";

import { useEffect, useState } from "react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
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
  className?: string;
}) {
  const url = canvasImageUrl(imagePath);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
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
        <g transform={`translate(${transform.x} ${transform.y}) rotate(${transform.rotation})`}>
          <image href={url} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" />
        </g>
        {zonesWithOutlines.map((zone, i) => {
          const centre = zone.points.reduce(
            (acc, p) => ({ x: acc.x + p.x / zone.points.length, y: acc.y + p.y / zone.points.length }),
            { x: 0, y: 0 }
          );
          return (
            <g key={i}>
              <polygon
                points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={`${zone.color}33`}
                stroke={zone.color}
                strokeWidth={3}
              />
              {numbered && (
                <>
                  <circle cx={centre.x} cy={centre.y} r={16} fill="#ffffff" stroke={zone.color} strokeWidth={3} />
                  <text
                    x={centre.x}
                    y={centre.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={18}
                    fontWeight="bold"
                    fill={zone.color}
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
