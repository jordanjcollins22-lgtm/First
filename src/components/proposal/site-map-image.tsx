"use client";

import { useEffect, useState } from "react";

import { canvasImageUrl } from "@/lib/canvas-image-url";
import { drawnSize, looksResized } from "@/lib/site-map-geometry";
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
  onZoneClick,
  showLegend = true,
  className,
}: {
  imagePath: string;
  transform: ProposalSiteImageTransform;
  /** Only the three fields the map draws with — narrowed so a caller with
   * shapes but no scope text can pass what it has.
   *
   * `number` overrides the marker, for when the caller is drawing a subset:
   * showing zone five on its own must still call it five, and counting the
   * zones actually drawn would call it one. */
  zones: (Pick<ProposalZoneSnapshot, "zoneName" | "color" | "points"> & { number?: number })[];
  /** Crop the view to a region of the canvas instead of showing all of it.
   * Placement of the photo is independent of this, so cropping is safe. */
  frame?: { x: number; y: number; width: number; height: number };
  /** Number each zone on the map, to match a numbered list beside it. */
  numbered?: boolean;
  /**
   * Called with the zone's position in `zones` when its shape is tapped.
   *
   * Tapping the shape is the obvious gesture and the one people try first,
   * but a polygon cannot be reached from a keyboard, so it is never the only
   * way in — whoever passes this also offers the same choice as buttons.
   */
  onZoneClick?: (index: number) => void;
  /**
   * The coloured key underneath. On by default, and turned off by a caller
   * that draws its own — otherwise picking a zone leaves two rows of names
   * saying almost the same thing.
   */
  showLegend?: boolean;
  /** Darken everything outside the zones. Turns a tinted shape on a busy
   * satellite photo into the only lit part of the picture, which is what a
   * crew need glancing at a phone in sunlight. */
  dimSurroundings?: boolean;
  className?: string;
}) {
  // The original, at its own resolution, and deliberately not a resized copy.
  //
  // Everything below is drawn from `naturalSize` -- the width the browser
  // reports for whatever image actually loaded -- multiplied by a scale that
  // was worked out on the evaluation board against the original's pixels.
  // Ask storage for a smaller copy and that multiplication silently means
  // something else: the photo is drawn at the wrong size inside a fixed
  // viewBox, so the map renders at the wrong zoom with the zones no longer
  // sitting on the ground they were drawn around. It happens on every load,
  // because none of this is stateful, and locking the board does not help --
  // the saved numbers were right, the reading of them was not.
  //
  // The transform records no natural size, so there is nothing to correct
  // against. Until it does, this image cannot be resized. The zone photos on
  // the proposal still are: they are tiles with no geometry riding on them,
  // and they were the bulk of the weight anyway.
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

  // Paired with its position in `zones` before filtering: a click has to
  // report the zone the caller passed, and an index into the drawn subset
  // would name a different one as soon as any zone has no outline.
  const zonesWithOutlines = zones
    .map((zone, index) => ({ zone, index }))
    .filter((entry) => entry.zone.points.length >= 2);

  if (!naturalSize) {
    return (
      <div
        className="w-full animate-pulse rounded-2xl border border-border bg-muted"
        style={{ aspectRatio: `${transform.canvasWidth} / ${transform.canvasHeight}` }}
      />
    );
  }

  const { width: w, height: h } = drawnSize(naturalSize, transform);

  // Said out loud rather than rendered wrong quietly. A saved design always
  // covers its board, so a photo that does not is not the photo these numbers
  // describe -- which in practice means somebody asked storage for a resized
  // copy again.
  if (process.env.NODE_ENV !== "production" && looksResized(naturalSize, transform)) {
    console.warn(
      `Site map ${imagePath} is smaller than the saved transform expects. ` +
        "The photo must be loaded at its original resolution: the drawn size is " +
        "its natural width times a scale worked out against the original's pixels."
    );
  }

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
              {zonesWithOutlines.map(({ zone }, i) => (
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
        {zonesWithOutlines.map(({ zone, index }, i) => {
          const centre = zone.points.reduce(
            (acc, p) => ({ x: acc.x + p.x / zone.points.length, y: acc.y + p.y / zone.points.length }),
            { x: 0, y: 0 }
          );
          return (
            <g
              key={i}
              onClick={onZoneClick ? () => onZoneClick(index) : undefined}
              // The shape is the obvious thing to tap and there is no way to
              // reach it from a keyboard, so it is a shortcut to the buttons
              // the caller draws rather than the only way to pick a zone.
              style={onZoneClick ? { cursor: "pointer" } : undefined}
            >
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
                    {/* Its number on the full map. Counting what is drawn
                        would renumber every zone the moment one is shown on
                        its own, and "zone 5" is what somebody says out loud
                        across a garden. */}
                    {zone.number ?? i + 1}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {showLegend && !numbered && zonesWithOutlines.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {zonesWithOutlines.map(({ zone }, i) => (
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
