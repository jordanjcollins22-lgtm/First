"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Home, Loader2 } from "lucide-react";

import { houseCoverage } from "@/lib/actions/house-coverage-actions";
import { clientDoors, warmDoors, type HouseCoverage } from "@/lib/coverage-shape";
import type { AttractorGeometry, AttractorGeometryType } from "@/types/domain";

/**
 * How many doors are in the area somebody has just drawn.
 *
 * The number that decides how many hangers to print and how many to carry.
 * Counted in the database over every house in the county, while the shape is
 * still being drawn as well as on the saved wave, because the moment it
 * changes a decision is the moment somebody is deciding how big to make the
 * circle. With the count comes what the walk needs: who on the street is
 * already ours, who has asked not to be contacted, and how many of each
 * design to print -- a door that has had a hanger gets the next one.
 */
export function AreaCoveragePanel({
  type,
  geometry,
  quantityDeployed,
  waveId,
}: {
  type: AttractorGeometryType;
  geometry: AttractorGeometry | null;
  /** What was actually put out, when the wave records it — turns the count
   * into a comparison rather than a target. */
  quantityDeployed?: number | null;
  /** A saved wave can hand its door list to the team as a spreadsheet. */
  waveId?: string;
}) {
  const [coverage, setCoverage] = useState<HouseCoverage | null>(null);
  const [state, setState] = useState<"idle" | "counting" | "error">("idle");
  const latest = useRef(0);
  const key = geometry ? `${type}:${JSON.stringify(geometry)}` : null;

  useEffect(() => {
    if (!key || !geometry) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setState("counting");
      const result = await houseCoverage(type, geometry);
      if (ticket !== latest.current) return;
      if (result.ok) {
        setCoverage(result.value);
        setState("idle");
      } else {
        setState("error");
      }
    }, 350);
    return () => clearTimeout(timer);
    // The key is the geometry, serialised; the geometry object itself is a
    // new reference on every render of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!geometry) return null;

  const shortfall =
    quantityDeployed != null && coverage && coverage.toHang > 0 ? coverage.toHang - quantityDeployed : null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Home className="h-4 w-4" />
          Houses in this area
        </p>
        <p className="flex items-center gap-1.5 text-xl font-bold tabular-nums">
          {state === "counting" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {coverage ? coverage.total.toLocaleString() : state === "error" ? "—" : "…"}
        </p>
      </div>

      {coverage && coverage.total > 0 && (
        <>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{coverage.toHang.toLocaleString()} to hang</span>
            <span>{coverage.byStage.untouched.toLocaleString()} never contacted</span>
            {warmDoors(coverage) > 0 && <span>{warmDoors(coverage).toLocaleString()} spoken to or quoted</span>}
            {clientDoors(coverage) > 0 && <span>{clientDoors(coverage).toLocaleString()} already clients</span>}
            {coverage.doNotContact > 0 && (
              <span className="font-semibold text-amber-800">{coverage.doNotContact} to skip</span>
            )}
          </div>

          {/* The print run: what to send to the printer, by design. */}
          <div className="mt-2 rounded-md bg-background/70 p-2 text-xs">
            <p className="mb-1 font-medium">Print run</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
              {coverage.printRun.map((line) => (
                <li key={line.design}>
                  Design {line.design}: <strong>{line.count.toLocaleString()}</strong>
                  {line.design === 1 && coverage.firstTime > 0 ? " (first-time doors)" : ""}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {coverage && coverage.total === 0 && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          No houses inside this shape. The county&apos;s addresses are all loaded, so an empty count means the
          shape is off the houses, not that they are missing.
        </p>
      )}

      {state === "error" && (
        <p className="mt-1.5 text-[11px] text-destructive">The count could not be run. Try adjusting the shape.</p>
      )}

      {shortfall != null && shortfall !== 0 && (
        <p className="mt-1.5 text-xs font-medium">
          {shortfall > 0
            ? `${shortfall.toLocaleString()} doors in this area got nothing — ${quantityDeployed} were put out.`
            : `${Math.abs(shortfall).toLocaleString()} more were put out than there are doors here.`}
        </p>
      )}

      {waveId && coverage && coverage.total > 0 && (
        <a
          href={`/api/waves/${waveId}/door-list`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline"
        >
          <Download className="h-3.5 w-3.5" />
          Door list for the team (spreadsheet)
        </a>
      )}
    </div>
  );
}
