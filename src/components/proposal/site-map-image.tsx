"use client";

import { useEffect, useState } from "react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

/** Re-renders the property photo with the drawn work-area outlines on top —
 * same transform math the live canvas board uses (translate, then rotate,
 * then draw the image centered at its natural size x scale). Zone points are
 * already in that same fixed canvas coordinate space, so they just draw
 * as-is on top, no further transform needed. */
export function SiteMapImage({
  imagePath,
  transform,
  zones,
}: {
  imagePath: string;
  transform: ProposalSiteImageTransform;
  zones: ProposalZoneSnapshot[];
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
        viewBox={`0 0 ${transform.canvasWidth} ${transform.canvasHeight}`}
        className="w-full rounded-2xl border border-border bg-muted"
      >
        <g transform={`translate(${transform.x} ${transform.y}) rotate(${transform.rotation})`}>
          <image href={url} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" />
        </g>
        {zonesWithOutlines.map((zone, i) => (
          <polygon
            key={i}
            points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={`${zone.color}33`}
            stroke={zone.color}
            strokeWidth={3}
          />
        ))}
      </svg>
      {zonesWithOutlines.length > 0 && (
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
