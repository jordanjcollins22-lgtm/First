"use client";

import { useId, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";

import { publicEnv, isMapboxConfigured } from "@/lib/public-env";
import { layoutLot, pathOf, satelliteUrl, type AreaKey, type LotData } from "@/lib/lot-map";

const WIDTH = 640;
const HEIGHT = 440;
const TAPPABLE: AreaKey[] = ["front", "back", "sides"];

/**
 * Their own lot from above, with the property line on it. Picking "Front
 * yard" lights up the front yard; tapping the front yard on the picture
 * picks it. If the front came out on the wrong side, one tap turns it.
 */
export function LotPicker({
  lot,
  picked,
  onToggle,
  disabled,
  readOnly = false,
}: {
  lot: LotData;
  picked: string[];
  onToggle?: (value: AreaKey) => void;
  disabled?: boolean;
  /** Just the picture: for showing them what they picked, with nothing to tap. */
  readOnly?: boolean;
}) {
  const [turn, setTurn] = useState(0);
  const clip = useId().replace(/:/g, "");
  const layout = useMemo(() => layoutLot(lot, WIDTH, HEIGHT, turn), [lot, turn]);
  if (!isMapboxConfigured) return null;

  const lit = (key: AreaKey) => picked.includes(key);

  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        {/* A static Mapbox photo: next/image has nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satelliteUrl(layout, publicEnv.mapboxToken)} alt="Your property from above" className="absolute inset-0 h-full w-full object-cover" />
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Your property line, with the parts you picked highlighted">
          <defs>
            <clipPath id={`lot-${clip}`}>
              <path d={pathOf(layout.parcel)} />
            </clipPath>
          </defs>
          {/* Everything off the lot a little darker, so the lot reads as the lot. */}
          <path d={`M0,0 H${WIDTH} V${HEIGHT} H0 Z ${pathOf(layout.parcel)}`} fill="black" fillOpacity={0.35} fillRule="evenodd" />

          <g clipPath={`url(#lot-${clip})`}>
            {(["whole", "front", "back", "sides", "foundation"] as AreaKey[]).map((key) =>
              lit(key)
                ? layout.regions[key].map((poly, i) => <path key={`${key}-${i}`} d={pathOf(poly)} fill="#4ade80" fillOpacity={key === "whole" ? 0.3 : 0.45} />)
                : null
            )}
            {/* Tap targets for the parts that are a place on the picture. */}
            {!disabled && !readOnly && onToggle &&
              TAPPABLE.map((key) =>
                layout.regions[key].map((poly, i) => (
                  <path key={`tap-${key}-${i}`} d={pathOf(poly)} fill="transparent" className="cursor-pointer" onClick={() => onToggle(key)} />
                ))
              )}
          </g>

          <path d={pathOf(layout.parcel)} fill="none" stroke="white" strokeWidth={2.5} strokeDasharray="7 5" pointerEvents="none" />
          {layout.house && (
            <path d={pathOf(layout.house)} fill="white" fillOpacity={lit("foundation") ? 0.15 : 0.08} stroke="white" strokeWidth={1.5} pointerEvents="none" />
          )}
          {layout.frontLabel && (
            <text
              x={Math.min(WIDTH - 60, Math.max(60, layout.frontLabel.at[0]))}
              y={Math.min(HEIGHT - 12, Math.max(20, layout.frontLabel.at[1]))}
              textAnchor="middle"
              className="fill-white text-[15px] font-semibold"
              style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 3 }}
              pointerEvents="none"
            >
              {layout.frontLabel.text}
            </text>
          )}
        </svg>
      </div>
      {readOnly ? (
        <figcaption className="text-xs text-muted-foreground">Your property line from the county, with the parts you picked.</figcaption>
      ) : (
      <figcaption className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Your property line from the county. Tap a part of the yard, or pick below.</span>
        <button type="button" onClick={() => setTurn((t) => (t + 1) % 4)} className="flex shrink-0 items-center gap-1 font-medium text-primary">
          <RotateCw className="h-3.5 w-3.5" /> Front&apos;s wrong?
        </button>
      </figcaption>
      )}
    </figure>
  );
}
