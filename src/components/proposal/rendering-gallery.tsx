"use client";

import type { ProposalOption, RenderingZone } from "@/lib/proposal-options";
import { renderingFor } from "@/lib/proposal-options";
import { cn } from "@/lib/utils";
import { PREVIEW } from "@/lib/storage-image-url";
import { ResizedImage } from "./resized-image";

/**
 * Their yard today beside the option they have picked, area by area.
 *
 * Tapping an option here is the same tap as on the price cards below, so a
 * client flicking between Low and High watches every area change at once
 * instead of reading two lists and imagining the difference.
 */
export function RenderingGallery({
  zones,
  options,
  selected,
  onSelect,
  locked,
}: {
  zones: RenderingZone[];
  options: ProposalOption[];
  selected: string | null;
  onSelect: (key: string) => void;
  locked: boolean;
}) {
  // Something to show before anything is picked: the one we recommend, or the first.
  const showing = selected ?? options.find((o) => o.recommended)?.key ?? options[0]?.key ?? null;
  const showingName = options.find((o) => o.key === showing)?.name ?? "After";

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">See your yard</h2>
        <p className="text-sm text-muted-foreground">Your photo today on the left. Tap a package to see it on the right.</p>
      </div>

      <div className="sticky top-0 z-10 -mx-4 flex justify-center gap-2 bg-background/95 px-4 py-2 backdrop-blur">
        {options.map((o) => {
          const on = showing === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={locked && !on}
              onClick={() => onSelect(o.key)}
              aria-pressed={on}
              className={cn(
                "rounded-full border-2 px-4 py-1.5 text-sm font-semibold transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50",
                locked && !on && "opacity-50"
              )}
            >
              {o.name}
            </button>
          );
        })}
      </div>

      {zones.map((zone) => {
        const after = renderingFor(zone, showing);
        const shared = !zone.after[showing ?? ""] && Boolean(zone.after.all);
        return (
          <div key={zone.name} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
            <p className="font-semibold">
              {zone.name}
              {shared && <span className="ml-2 text-xs font-normal text-muted-foreground">Same in every package</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <figure className="flex flex-col gap-1">
                <ResizedImage path={zone.before} transform={PREVIEW} alt={`${zone.name} today`} aspect="aspect-square" />
                <figcaption className="text-center text-xs font-semibold text-muted-foreground">Today</figcaption>
              </figure>
              <figure className="flex flex-col gap-1">
                {after ? (
                  <ResizedImage key={after} path={after} transform={PREVIEW} alt={`${zone.name}, ${showingName}`} aspect="aspect-square" />
                ) : (
                  <div className="aspect-square rounded-lg bg-muted" />
                )}
                <figcaption className="text-center text-xs font-semibold text-primary">{shared ? "After" : showingName}</figcaption>
              </figure>
            </div>
          </div>
        );
      })}

      <p className="text-center text-xs text-muted-foreground">
        Renderings are made from your own photos. They show the look and style but are not exactly to scale; plants are
        shown at about one year after planting.
      </p>
    </div>
  );
}
