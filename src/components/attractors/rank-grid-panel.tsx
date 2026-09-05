"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addKeyword, retireKeyword, runScan } from "@/lib/actions/rank-grid-actions";
import {
  BANDS,
  DEFAULT_GRID_SIZE,
  DEFAULT_SPACING_MILES,
  averageRank,
  bandCounts,
  gridSpanMiles,
  movement,
  packShare,
  type GridSize,
  type ScanPoint,
} from "@/lib/rank-grid";
import type { Keyword, Scan } from "@/lib/data/rank-grid";

interface RankGridPanelProps {
  keywords: Keyword[];
  scans: Scan[];
  previousPoints: Record<string, ScanPoint[]>;
  selectedKeywordId: string | null;
  onSelectKeyword: (id: string | null) => void;
  /** Where the grid is centred — the yard, unless there is nowhere to start. */
  base: { lat: number; lng: number } | null;
}

/**
 * How we rank, keyword by keyword.
 *
 * Every number here is about one phrase and one grid, because that is the
 * only way a ranking means anything: a single "we're #4" hides that we are
 * first on one side of town and nowhere on the other.
 */
export function RankGridPanel({
  keywords,
  scans,
  previousPoints,
  selectedKeywordId,
  onSelectKeyword,
  base,
}: RankGridPanelProps) {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const scanByKeyword = new Map(scans.map((scan) => [scan.keywordId, scan]));
  const selected = selectedKeywordId ? scanByKeyword.get(selectedKeywordId) : undefined;

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Where we rank</h3>
        <p className="text-xs text-muted-foreground">
          Local results move with where somebody is standing. Pick a phrase to put its grid on the
          map.
        </p>
      </div>

      <div className="flex gap-1">
        <Input
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="lawn care near me"
          className="h-9 text-sm"
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || !phrase.trim()}
          onClick={() =>
            run(async () => {
              const result = await addKeyword(phrase);
              if (result.ok) setPhrase("");
              return result;
            })
          }
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {keywords.length === 0 ? (
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-md">
          No phrases yet. Add the ones customers actually type — &ldquo;lawn care near me&rdquo;,
          &ldquo;mulch delivery Bel Air&rdquo;.
        </p>
      ) : (
        <ul className="space-y-1">
          {keywords.map((keyword) => {
            const scan = scanByKeyword.get(keyword.id);
            const average = scan ? averageRank(scan.points) : null;
            const isSelected = keyword.id === selectedKeywordId;

            return (
              <li key={keyword.id}>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                    isSelected ? "border-primary bg-primary/5" : "border-white/60 bg-card/60"
                  } backdrop-blur-md`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectKeyword(isSelected ? null : keyword.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium">{keyword.phrase}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {scan
                        ? `avg ${average!.toFixed(1)} · ${Math.round(packShare(scan.points) * 100)}% in the pack`
                        : "Never checked"}
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={pending || !base}
                    title={base ? "Check it now" : "Add a business location first"}
                    onClick={() =>
                      run(() =>
                        runScan({
                          keywordId: keyword.id,
                          centreLat: base!.lat,
                          centreLng: base!.lng,
                          gridSize: DEFAULT_GRID_SIZE as GridSize,
                          spacingMiles: DEFAULT_SPACING_MILES,
                        })
                      )
                    }
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    disabled={pending}
                    onClick={() => run(() => retireKeyword(keyword.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            failed ? "bg-amber-500/15 text-amber-800" : "bg-emerald-500/15 text-emerald-700"
          }`}
        >
          {message}
        </p>
      )}

      {selected && <ScanSummary scan={selected} previous={previousPoints[selected.keywordId]} />}
    </div>
  );
}

function ScanSummary({ scan, previous }: { scan: Scan; previous: ScanPoint[] | undefined }) {
  const counts = bandCounts(scan.points);
  const average = averageRank(scan.points);
  const moved = previous ? movement(scan.points, previous) : null;

  return (
    <div className="space-y-2 rounded-lg border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {gridSpanMiles(scan.gridSize as GridSize, scan.spacingMiles)} miles across ·{" "}
          {new Date(scan.ranAt).toLocaleDateString()}
        </span>
        {moved != null && moved !== 0 && (
          <span
            className={`text-xs font-medium ${moved > 0 ? "text-emerald-700" : "text-red-700"}`}
          >
            {moved > 0 ? "↑" : "↓"} {Math.abs(moved).toFixed(1)} since last time
          </span>
        )}
      </div>

      <p className="text-2xl font-bold tabular-nums">
        {average?.toFixed(1) ?? "—"}
        <span className="ml-1 text-sm font-normal text-muted-foreground">average place</span>
      </p>

      <ul className="space-y-0.5">
        {Object.values(BANDS).map((band) => (
          <li key={band.band} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: band.colour }}
              aria-hidden
            />
            <span className="flex-1">{band.label}</span>
            <span className="tabular-nums text-muted-foreground">{counts[band.band]}</span>
          </li>
        ))}
      </ul>

      {scan.source === "manual" && (
        <p className="text-[11px] text-muted-foreground">Filled in by hand.</p>
      )}
    </div>
  );
}
