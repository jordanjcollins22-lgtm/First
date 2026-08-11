import { listAttractorTypes, listAttractorVariants, listAttractorWaves } from "@/lib/data/attractors";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listBusinessLocations, listLocationAreas } from "@/lib/data/locations";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { AttractorsDashboard } from "@/components/attractors/attractors-dashboard";
import type { AttractorType, AttractorVariant, AttractorWave, BusinessLocation, LocationArea } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";

export default async function AttractorsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  let types: AttractorType[] = [];
  let variants: AttractorVariant[] = [];
  let waves: AttractorWave[] = [];
  let jobs: JobWithLocation[] = [];
  let migrationMissing = false;
  try {
    [types, variants, waves, jobs] = await Promise.all([
      listAttractorTypes(),
      listAttractorVariants(),
      listAttractorWaves(),
      listJobsWithLocation(),
    ]);
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Attractors Data</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0022_attractors.sql</code>, then reload this page.
        </p>
      </div>
    );
  }

  // Business locations/areas are a separate, later migration (0023) — fall
  // back to empty rather than breaking the whole page if it hasn't run yet.
  let locations: BusinessLocation[] = [];
  let areas: LocationArea[] = [];
  let locationsMigrationMissing = false;
  try {
    [locations, areas] = await Promise.all([listBusinessLocations(), listLocationAreas()]);
  } catch {
    locationsMigrationMissing = true;
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8">
      {locationsMigrationMissing && (
        <p className="mb-4 rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Business locations aren&apos;t set up yet. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0023_business_locations.sql</code>, then reload this page.
        </p>
      )}
      <AttractorsDashboard types={types} variants={variants} waves={waves} jobs={jobs} locations={locations} areas={areas} />
    </div>
  );
}
