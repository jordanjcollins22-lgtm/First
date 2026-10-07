"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Mailbox } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  closedLabel,
  defaultDirection,
  hasPlace,
  nextDirection,
  SORTS,
  sortEntries,
  type Direction,
  type MapEntry,
  type SortKey,
} from "@/lib/map-index";

/**
 * Everything on the map worth going to, in one list.
 *
 * The map knew about finished jobs and about carrier routes and offered no way
 * to walk either. Finding the job closed last Thursday meant panning until a
 * pin looked familiar; finding a particular route meant knowing its number.
 *
 * Work we have just finished sits at the top, because that is where the next
 * job comes from — a fresh lawn is the best advertisement on the street — and
 * the routes sit under it, because that is the other way onto the same street.
 *
 * Clicking a row takes the map there. Clicking a route also draws it, which is
 * the whole reason somebody opens this looking for one.
 */
export function MapIndexList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: MapEntry[];
  selectedId: string | null;
  onSelect: (entry: MapEntry) => void;
}) {
  const [sort, setSort] = useState<SortKey>("recent");
  const [direction, setDirection] = useState<Direction>(defaultDirection("recent"));

  const ordered = useMemo(() => sortEntries(entries, sort, direction), [entries, sort, direction]);
  const jobs = ordered.filter((entry) => entry.kind === "job");
  const routes = ordered.filter((entry) => entry.kind === "route");

  function clickSort(key: SortKey) {
    setDirection(nextDirection(sort, key, direction));
    setSort(key);
  }

  if (entries.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">Nothing finished yet, and no routes loaded.</p>;
  }

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-card/95 px-2 py-1.5 backdrop-blur">
        {SORTS.map((option) => {
          const on = option.key === sort;
          return (
            <button
              key={option.key}
              type="button"
              title={option.hint}
              onClick={() => clickSort(option.key)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]",
                on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
              {on &&
                (direction === "desc" ? (
                  <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUp className="h-3 w-3" />
                ))}
            </button>
          );
        })}
      </div>

      <Section
        title="Finished work"
        hint="Where the next job comes from"
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        entries={jobs}
        selectedId={selectedId}
        onSelect={onSelect}
        empty="No jobs signed off yet."
      />
      <Section
        title="USPS routes"
        hint="Click one to draw it on the map"
        icon={<Mailbox className="h-3.5 w-3.5" />}
        entries={routes}
        selectedId={selectedId}
        onSelect={onSelect}
        empty="No carrier routes loaded."
      />
    </div>
  );
}

function Section({
  title,
  hint,
  icon,
  entries,
  selectedId,
  onSelect,
  empty,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  entries: MapEntry[];
  selectedId: string | null;
  onSelect: (entry: MapEntry) => void;
  empty: string;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1 pt-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {title} ({entries.length})
        </h3>
      </div>
      <p className="px-2.5 pb-1 text-[10px] text-muted-foreground">{hint}</p>
      {entries.length === 0 ? (
        <p className="px-2.5 pb-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-1.5 pb-2">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <button
                type="button"
                disabled={!hasPlace(entry)}
                onClick={() => onSelect(entry)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  entry.id === selectedId ? "bg-primary/10" : "hover:bg-accent",
                  !hasPlace(entry) && "cursor-not-allowed opacity-50"
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.title}</span>
                  {entry.closedAt && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {closedLabel(entry.closedAt)}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-[10px] text-muted-foreground">{entry.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
