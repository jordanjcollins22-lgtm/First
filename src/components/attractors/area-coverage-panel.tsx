"use client";

import { Home } from "lucide-react";

import { coverageFor, describeCoverage, type AreaAddress } from "@/lib/area-coverage";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";

/**
 * How many doors are in the area somebody has just drawn.
 *
 * The number that decides how many hangers to print and how many to carry.
 * Shown while the shape is still being drawn as well as on the saved wave,
 * because the moment it changes a decision is the moment somebody is deciding
 * how big to make the circle.
 *
 * The caveat under the number is not decoration. A bare count invites somebody
 * to order exactly that many, and a count drawn only from our own client book
 * is a fraction of the street.
 */
export function AreaCoveragePanel({
  type,
  geometry,
  addresses,
  quantityDeployed,
}: {
  type: AttractorGeometryType;
  geometry: AttractorGeometry | null;
  addresses: AreaAddress[];
  /** What was actually put out, when the wave records it — turns the count
   * into a comparison rather than a target. */
  quantityDeployed?: number | null;
}) {
  if (!geometry) return null;

  const coverage = coverageFor(type, geometry, addresses);
  const shortfall =
    quantityDeployed != null && coverage.toHang > 0 ? coverage.toHang - quantityDeployed : null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Home className="h-4 w-4" />
          Houses in this area
        </p>
        <p className="text-xl font-bold tabular-nums">
          {coverage.countIsFloor && coverage.total > 0 ? `${coverage.total}+` : coverage.total}
        </p>
      </div>

      {coverage.total > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{coverage.toHang} to hang</span>
          {coverage.prospects > 0 && <span>{coverage.prospects} not clients yet</span>}
          {coverage.clients > 0 && <span>{coverage.clients} already ours</span>}
          {coverage.doNotContact > 0 && (
            <span className="font-semibold text-amber-800">{coverage.doNotContact} to skip</span>
          )}
        </div>
      )}

      {shortfall != null && shortfall !== 0 && (
        <p className="mt-1.5 text-xs font-medium">
          {shortfall > 0
            ? `${shortfall} doors in this area got nothing — ${quantityDeployed} were put out.`
            : `${Math.abs(shortfall)} more were put out than there are doors on file here.`}
        </p>
      )}

      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{describeCoverage(coverage)}</p>
    </div>
  );
}
