"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Footprints, Loader2, MapPin, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { eddmBuildStatus, pauseEddmBuild, resumeEddmBuild, startEddmBuild, type EddmBuildStatus } from "@/lib/actions/eddm-build-actions";
import type { EddmRouteSummary } from "@/lib/data/eddm-build";
import { describeClusters, type UnservedCluster } from "@/lib/eddm-clusters";
import type { ZoneRow } from "@/lib/data/zones";
import { crewFor, formatMinutes, MODE_COLOR, MODE_LABEL, modeOf, rankZones } from "@/lib/zones";

/**
 * The door-hanger routes, built from USPS's carrier routes without drawing.
 *
 * One button builds the county: every ZIP's routes from USPS, each judged
 * walkable or hard, a wave and a zone for every walkable one, every house
 * put on its route. Progress is read back every few seconds while it runs,
 * because the work is on the server and this page has no other way to know.
 * Under it, the houses no route reaches, grouped: a couple beside a route
 * are doors for the walk to take in; a few dozen together are a development.
 */
export function EddmBuildPanel({
  build,
  summary,
  clusters,
  showUnserved,
  onToggleShowUnserved,
  onFlyTo,
  zones,
  onFocusZone,
}: {
  build: EddmBuildStatus | null;
  summary: EddmRouteSummary;
  clusters: UnservedCluster[];
  showUnserved: boolean;
  onToggleShowUnserved: () => void;
  onFlyTo: (target: { lat: number; lng: number }) => void;
  /** The zones, every house in exactly one, with how each is covered. */
  zones: ZoneRow[];
  onFocusZone: (id: string) => void;
}) {
  const [showAllZones, setShowAllZones] = useState(false);
  const ranked = rankZones(zones);
  const byMode = (m: string) => zones.filter((z) => z.mode === m);
  const hours = (list: ZoneRow[]) => Math.round(list.reduce((s, z) => s + (z.minutes ?? 0), 0) / 60);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<EddmBuildStatus | null>(build);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // While a build runs, ask how far it has got, and refresh the page's data
  // when it finishes so the new waves and the unreached houses appear.
  const running = status?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const result = await eddmBuildStatus();
      if (!result.ok || !result.value) return;
      setStatus(result.value);
      if (result.value.status !== "running") router.refresh();
    }, 8_000);
    return () => clearInterval(timer);
  }, [running, router]);

  function run(work: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const fresh = await eddmBuildStatus();
      if (fresh.ok && fresh.value) setStatus(fresh.value);
      router.refresh();
    });
  }

  const visible = showAll ? clusters : clusters.slice(0, 8);
  const built = summary.routes > 0;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Footprints className="h-4 w-4" /> Door-hanger routes from USPS
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {built
            ? `${summary.routes} USPS routes across ${summary.zips} ZIPs: ${summary.walkable} walkable (${summary.waves} waves made), ${summary.hard} hard to walk` +
              (summary.unknown > 0 ? `, ${summary.unknown} not yet judged` : "") +
              `. ${summary.housesOnRoutes.toLocaleString()} houses on a route.`
            : "Every USPS carrier route in the county becomes a door-hanger wave and a zone with its houses, without anyone drawing. Routes with a main road through them, and the routes USPS drives, are marked hard and left out."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!running && (
          <Button type="button" size="sm" disabled={isPending} onClick={() => run(startEddmBuild)}>
            {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            {built ? "Rebuild for all of Harford" : "Build for all of Harford"}
          </Button>
        )}
        {running && status && (
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => pauseEddmBuild(status.jobId))}>
            <Pause className="mr-1 h-3.5 w-3.5" /> Pause
          </Button>
        )}
        {status && (status.status === "paused" || status.status === "failed") && (
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => resumeEddmBuild(status.jobId))}>
            <Play className="mr-1 h-3.5 w-3.5" /> Resume
          </Button>
        )}
      </div>

      {status && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {running && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />}
          <span>{status.summary}</span>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {zones.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">Zones: every house in exactly one, none overlapping</p>
          <p className="text-xs text-muted-foreground">
            {(["foot", "scooter", "vehicle"] as const)
              .map((m) => `${byMode(m).length} ${MODE_LABEL[m].toLowerCase()} (${byMode(m).reduce((s, z) => s + z.houses, 0).toLocaleString()} doors, ${hours(byMode(m))} h)`)
              .join(" · ")}
            . Click a zone on the map for its walk and where to park.
          </p>
          <ul className="space-y-1">
            {(showAllZones ? ranked : ranked.slice(0, 10)).map((z) => {
              const mode = modeOf(z.mode);
              return (
                <li key={z.id} className="flex items-center gap-2 text-xs">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: mode ? MODE_COLOR[mode] : "#94a3b8" }} title={mode ? MODE_LABEL[mode] : ""} />
                  <span className="font-medium">{z.name}</span>
                  <span className="truncate text-muted-foreground">
                    {z.houses.toLocaleString()} doors · {formatMinutes(z.minutes)} · {crewFor(z.minutes)} people
                    {z.clients ? ` · ${z.clients} client${z.clients === 1 ? "" : "s"}` : ""}
                  </span>
                  <button type="button" className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline" onClick={() => onFocusZone(z.id)} title="Show the zone and its walk">
                    <MapPin className="h-3 w-3" /> Walk
                  </button>
                </li>
              );
            })}
          </ul>
          {zones.length > 10 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAllZones((v) => !v)}>
              {showAllZones ? "Show fewer" : `Show all ${zones.length} zones`}
            </button>
          )}
        </div>
      )}

      {built && (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <input type="checkbox" checked={showUnserved} onChange={onToggleShowUnserved} className="h-3.5 w-3.5" />
            Houses off any USPS route
          </label>
          <p className="text-xs text-muted-foreground">{describeClusters(clusters)}</p>
          {visible.length > 0 && (
            <ul className="space-y-1">
              {visible.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={
                      c.kind === "development"
                        ? "rounded bg-fuchsia-600/15 px-1.5 py-0.5 font-medium text-fuchsia-700"
                        : "rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                    }
                  >
                    {c.kind === "development" ? "Development" : "Missed doors"}
                  </span>
                  <span className="font-medium">{c.houses}</span>
                  <span className="truncate text-muted-foreground">
                    near {c.sample}
                    {c.zip ? `, ${c.zip}` : ""}
                  </span>
                  <button
                    type="button"
                    className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                    onClick={() => onFlyTo({ lat: c.lat, lng: c.lng })}
                    title="Show on the map"
                  >
                    <MapPin className="h-3 w-3" /> Show
                  </button>
                </li>
              ))}
            </ul>
          )}
          {clusters.length > 8 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${clusters.length} groups`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
