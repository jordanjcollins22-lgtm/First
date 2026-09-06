"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pauseSdatImport, resumeSdatImport, sdatStatus, startSdatImport, type SdatStatus } from "@/lib/actions/sdat-actions";
import type { OwnershipSummary } from "@/lib/data/ownership";
import { DEFAULT_SDAT_URL } from "@/lib/sdat";
import type { PointColorMode } from "@/lib/house-geojson";

/**
 * Who owns the houses, from the State's assessment roll.
 *
 * One button reads Maryland's parcel data for Harford and writes, beside
 * every house we hold, whether the owner lives there or the tax bill goes
 * elsewhere, and when it last sold for what. The map can then colour by
 * that instead of by stage, and a door list says whose door it is.
 */
export function OwnershipPanel({
  job,
  summary,
  colorMode,
  onColorMode,
}: {
  job: SdatStatus | null;
  summary: OwnershipSummary;
  colorMode: PointColorMode;
  onColorMode: (mode: PointColorMode) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<SdatStatus | null>(job);
  const [url, setUrl] = useState(DEFAULT_SDAT_URL);
  const [showUrl, setShowUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = status?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const result = await sdatStatus();
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
      const fresh = await sdatStatus();
      if (fresh.ok && fresh.value) setStatus(fresh.value);
      router.refresh();
    });
  }

  const known = summary.known > 0;
  const pct = (n: number) => (summary.known > 0 ? `${Math.round((100 * n) / summary.known)}%` : "");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Home className="h-4 w-4" /> Who owns the houses
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {known
            ? `${summary.known.toLocaleString()} of ${summary.houses.toLocaleString()} houses on the State's roll: ${summary.ownerOccupied.toLocaleString()} owner-occupied (${pct(summary.ownerOccupied)}), ${summary.absentee.toLocaleString()} absentee or rented (${pct(summary.absentee)}). ${summary.soldLastYear.toLocaleString()} changed hands in the last year, ${summary.soldLast90.toLocaleString()} in the last ninety days.`
            : "Maryland's assessment roll says who owns every parcel, where the tax bill goes, and when it last sold. Read once for the county, it tells the map which houses are rented and which just changed hands."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!running && (
          <Button type="button" size="sm" disabled={isPending} onClick={() => run(() => startSdatImport(url))}>
            {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            {known ? "Refresh from the State" : "Read the State's roll"}
          </Button>
        )}
        {running && status && (
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => pauseSdatImport(status.jobId))}>
            <Pause className="mr-1 h-3.5 w-3.5" /> Pause
          </Button>
        )}
        {status && (status.status === "paused" || status.status === "failed") && (
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => resumeSdatImport(status.jobId))}>
            <Play className="mr-1 h-3.5 w-3.5" /> Resume
          </Button>
        )}
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setShowUrl((v) => !v)}>
          {showUrl ? "Hide source" : "Source"}
        </button>
      </div>
      {showUrl && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[11px]"
          spellCheck={false}
          title="The State's parcel layer on MD iMAP. Change only if the State moves it."
        />
      )}

      {status && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {running && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />}
          <span>{status.summary}</span>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {known && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
          <span className="text-muted-foreground">Colour every address by</span>
          {(["stage", "ownership", "sold"] as PointColorMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onColorMode(mode)}
              className={
                colorMode === mode
                  ? "rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground"
                  : "rounded-md border border-border px-2 py-1 font-medium"
              }
            >
              {mode === "stage" ? "Where we stand" : mode === "ownership" ? "Owner or rented" : "Sold this year"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
