import { CoverageMapView } from "./coverage-map-view";
import { describeCoverage, type CoverageSummary } from "@/lib/coverage-map";

/**
 * How much of the county has been touched.
 *
 * The bar is deliberately the first thing: the goal is a marker on every
 * property, and the only honest measure of that goal is how much is still
 * grey. Everything else on this page is how the grey gets used up.
 */
export function CoveragePanel({
  summary,
  setupNeeded,
}: {
  summary: CoverageSummary;
  setupNeeded: boolean;
}) {
  if (setupNeeded) {
    return (
      <section className="mb-8 rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm">
        The coverage map needs its database migration. Run{" "}
        <code>supabase/migrations/0076_lead_prospects.sql</code> in Supabase, then import the county&apos;s
        parcels from the Leads page.
      </section>
    );
  }

  const percent = Math.round(summary.fraction * 100);

  return (
    <section className="mb-8">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">County coverage</h2>
        <span className="text-sm font-bold tabular-nums">{percent}%</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        A marker on every property, and whether anybody has spoken to it. Somebody out of our market is
        still worth a call — they know the neighbour who is not.
      </p>

      <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Properties on file" value={summary.total.toLocaleString()} />
        <Tile label="Contacted" value={summary.touched.toLocaleString()} />
        <Tile
          label="Still grey"
          value={(summary.total - summary.touched).toLocaleString()}
          hint={describeCoverage(summary).includes("Import") ? "Import the county" : undefined}
        />
        <Tile
          label="Names given"
          value={summary.referrals.toLocaleString()}
          hint="From people who weren't buying"
        />
      </div>

      <CoverageMapView summary={summary} />
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
