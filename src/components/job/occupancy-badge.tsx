"use client";

import { useEffect, useState } from "react";
import { Home, KeyRound } from "lucide-react";

import { occupancyBadge, type OccupancyFacts } from "@/lib/occupancy";
import { cn } from "@/lib/utils";

/**
 * Owns or rents, under the address, from the county data.
 *
 * Rendered from the roll first. When the roll left the house unknown, the
 * State's property record is read once through the owner lookup, which
 * keeps what it finds, and the badge settles without anybody asking.
 */
export function OccupancyBadge({ houseId, facts }: { houseId: string | null; facts: OccupancyFacts }) {
  const [live, setLive] = useState<OccupancyFacts>(facts);

  useEffect(() => {
    if (!houseId || facts.ownerOccupied != null) return;
    let cancelled = false;
    fetch(`/api/houses/${houseId}/owner`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ownerName?: string | null; ownerOccupied?: boolean | null; reason?: string | null } | null) => {
        if (cancelled || !body) return;
        setLive({
          ownerOccupied: body.ownerOccupied ?? null,
          reason: body.ownerOccupied == null ? (body.reason ?? "The State's record did not settle it.") : null,
          ownerName: body.ownerName ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [houseId, facts.ownerOccupied]);

  const badge = occupancyBadge(live);
  const unsettled = live.ownerOccupied == null && !live.noHouse && live.reason;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          badge.tone === "good" && "border-emerald-600/40 bg-emerald-50 text-emerald-800",
          badge.tone === "warn" && "border-amber-500/50 bg-amber-50 text-amber-800",
          badge.tone === "muted" && "border-border bg-muted text-muted-foreground"
        )}
      >
        {badge.tone === "warn" ? <KeyRound className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
        {unsettled ? "Own or rent? Not settled" : badge.label}
      </span>
      <span className="text-[11px] text-muted-foreground">{unsettled ? live.reason : badge.detail}</span>
    </div>
  );
}
