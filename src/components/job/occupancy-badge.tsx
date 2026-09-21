"use client";

import { useState, useTransition } from "react";
import { Home, KeyRound } from "lucide-react";

import { setPropertyOccupancy } from "@/lib/actions/property-actions";
import { occupancyBadge, type Occupancy, type OccupancyFacts } from "@/lib/occupancy";
import { cn } from "@/lib/utils";

/**
 * Owns or rents, under the address, with the two answers a tap away.
 *
 * The badge reads the client's word first and the State's roll second. The
 * buttons record what the client said, so the next person to open the job
 * does not have to ask again.
 */
export function OccupancyBadge({ propertyId, facts }: { propertyId: string; facts: OccupancyFacts }) {
  const [told, setTold] = useState<Occupancy | null>(facts.told);
  const [pending, start] = useTransition();
  const badge = occupancyBadge({ ...facts, told });

  function record(next: Occupancy) {
    const value = told === next ? null : next;
    setTold(value);
    start(async () => {
      const result = await setPropertyOccupancy(propertyId, value);
      if (!result.ok) setTold(told);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          badge.tone === "good" && "border-emerald-600/40 bg-emerald-50 text-emerald-800",
          badge.tone === "warn" && "border-amber-500/50 bg-amber-50 text-amber-800",
          badge.tone === "muted" && "border-border bg-muted text-muted-foreground"
        )}
        title={badge.detail}
      >
        {badge.tone === "warn" ? <KeyRound className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
        {badge.label}
      </span>
      <span className="text-[11px] text-muted-foreground">{badge.detail}</span>
      <span className="ml-auto flex gap-1">
        {(["owner", "renter"] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={pending}
            onClick={() => record(option)}
            aria-pressed={told === option}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              told === option ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent/40"
            )}
          >
            {option === "owner" ? "Client owns" : "Client rents"}
          </button>
        ))}
      </span>
    </div>
  );
}
