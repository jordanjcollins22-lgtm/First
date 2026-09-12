"use client";

import { useState } from "react";

import { SiteMapImage } from "@/components/proposal/site-map-image";
import { focusFrame } from "@/lib/zone-focus";
import type { ProposalSiteImageTransform, ProposalZoneSnapshot } from "@/types/domain";

type MapZone = Pick<ProposalZoneSnapshot, "zoneName" | "color" | "points"> & { number?: number };

/**
 * The site map with one work area picked out.
 *
 * The whole-property map answers "where is this job". Standing in the garden
 * the question is "which bed did you mean", and seven outlines on one
 * satellite photo on a phone in sunlight is not an answer to it. Tap a zone
 * and the map shows that one, framed on it, with the rest out of the way.
 *
 * A wrapper rather than more props on the map itself, because the map is
 * drawn from a server component on the crew sheet and from a client one on
 * the proposal. Holding the choice here means the crew sheet does not have to
 * become a client component to gain a button.
 *
 * The zone can be picked two ways on purpose. Tapping the shape is what
 * people try first; the buttons underneath are what works from a keyboard,
 * and what tells you the zone is pickable at all before you have tried.
 */
export function FocusableSiteMap({
  imagePath,
  transform,
  zones,
  defaultFrame,
  numbered = false,
  dimSurroundings = false,
  className,
}: {
  imagePath: string;
  transform: ProposalSiteImageTransform;
  zones: MapZone[];
  /**
   * What to show when no single zone is picked. The crew sheet frames on the
   * work rather than the whole property, and picking a zone and coming back
   * again must land where it started.
   */
  defaultFrame?: { x: number; y: number; width: number; height: number };
  numbered?: boolean;
  dimSurroundings?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState<number | null>(null);

  // Only a zone with an outline can be framed or drawn, and its position in
  // the caller's array is what the rest of this works in.
  const pickable = zones
    .map((zone, index) => ({ zone, index }))
    .filter((entry) => entry.zone.points.length >= 2);

  // A single zone is already the only thing on the map; offering to isolate
  // it is a button that appears to do nothing.
  const worthPicking = pickable.length > 1;

  const active = focused != null ? zones[focused] : null;
  const shown = active ? [active] : zones;
  const frame = active
    ? focusFrame(active.points, transform.canvasWidth, transform.canvasHeight)
    : defaultFrame;

  function toggle(index: number) {
    // Tapping the zone you are already looking at goes back, which is the
    // gesture people try before they look for a way out.
    setFocused((was) => (was === index ? null : index));
  }

  return (
    <div className="flex flex-col gap-2">
      <SiteMapImage
        imagePath={imagePath}
        transform={transform}
        zones={shown}
        frame={frame}
        numbered={numbered}
        dimSurroundings={dimSurroundings}
        // The index is into whatever was passed as `zones`, which is every
        // zone until one is picked and just that one afterwards. So while
        // nothing is picked the index is already the one this component works
        // in; once something is, the only shape on screen is the picked one
        // and tapping it goes back.
        onZoneClick={worthPicking ? (i) => toggle(focused ?? i) : undefined}
        // The buttons below are a legend that does something, so they replace
        // the plain one. Where there are none -- a map with a single zone on
        // it -- the plain one is still the only thing naming that zone.
        showLegend={!worthPicking}
        className={className}
      />

      {worthPicking && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pickable.map(({ zone, index }) => {
            const on = focused === index;
            return (
              <button
                key={index}
                type="button"
                onClick={() => toggle(index)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-transparent bg-foreground font-semibold text-background"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: zone.color }}
                  aria-hidden
                />
                {zone.zoneName}
              </button>
            );
          })}

          {/* Only once there is something to come back from. A permanent
              "Show all" next to an unfiltered map is a control that does
              nothing, and people click it to find out. */}
          {focused != null && (
            <button
              type="button"
              onClick={() => setFocused(null)}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
