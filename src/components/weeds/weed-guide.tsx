"use client";

import { useMemo, useState } from "react";

import { groupWeeds, type Weed } from "@/lib/weeds";
import { WeedRow } from "@/components/weeds/weed-row";

type Filter = "needs-photo" | "client" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "needs-photo", label: "Needs a photo" },
  { key: "client", label: "On the client sheet" },
  { key: "all", label: "All weeds" },
];

/**
 * The guide, with the work still to do at the front.
 *
 * Sixty-three weeds is a long page to scroll looking for the ones without a
 * photograph, so the page opens on exactly those. The client sheet is the one
 * that goes to a house, so its weeds come first within that.
 */
export function WeedGuide({ weeds }: { weeds: Weed[] }) {
  const missing = weeds.filter((w) => !w.printPhotoId);
  const [filter, setFilter] = useState<Filter>(missing.length > 0 ? "needs-photo" : "all");

  const shown = useMemo(() => {
    const list =
      filter === "needs-photo" ? weeds.filter((w) => !w.printPhotoId) : filter === "client" ? weeds.filter((w) => w.client) : weeds;
    // Within a filter the client's come first: they are the ones a homeowner
    // is handed, and a blank square there is the one that costs something.
    return [...list].sort((a, b) => Number(b.client) - Number(a.client));
  }, [weeds, filter]);

  const blocks = groupWeeds(shown);
  const withPhoto = weeds.length - missing.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => {
          const count =
            option.key === "needs-photo" ? missing.length : option.key === "client" ? weeds.filter((w) => w.client).length : weeds.length;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                filter === option.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"
              }`}
            >
              {option.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {withPhoto} of {weeds.length} weeds have the photo that prints
          </span>
          <span className="tabular-nums">{Math.round((withPhoto / Math.max(weeds.length, 1)) * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(withPhoto / Math.max(weeds.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Every weed has a photo. Both sheets are ready to print.
        </p>
      ) : (
        blocks.map((block) => (
          <section key={block.group}>
            <h2 className="mb-2 text-sm font-semibold">
              {block.group}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{block.weeds.length}</span>
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {block.weeds.map((weed) => (
                <WeedRow key={weed.id} weed={weed} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
