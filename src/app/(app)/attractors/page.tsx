import { listAttractorTypes, listAttractorVariants, listAttractorWaves } from "@/lib/data/attractors";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listBusinessLocations, listLocationAreas } from "@/lib/data/locations";
import { listProperties } from "@/lib/data/properties";
import { listProspectAddresses } from "@/lib/data/prospects";
import { getDensityPoints } from "@/lib/data/density";
import { listKeywords, listLatestScans, listPreviousScanPoints } from "@/lib/data/rank-grid";
import { listProfiles } from "@/lib/data/team";
import { checkTabAccess } from "@/lib/data/access";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { AttractorsDashboard } from "@/components/attractors/attractors-dashboard";
import type { AttractorType, AttractorVariant, AttractorWave, BusinessLocation, LocationArea, Profile } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";
import { AccessDeniedNotice } from "@/components/access-denied-notice";

export default async function AttractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed, profile } = await checkTabAccess("project-data");
  if (profile && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">Project Data</h1>
        <p className="text-sm text-muted-foreground">
          Your account doesn&apos;t have access to this page. Ask an admin to grant it under Databases &rarr;
          Permissions.
        </p>
      </div>
    );
  }

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
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">Project Data</h1>
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

  // Properties are core data (migration 0001) so this should never fail in
  // practice; profiles depend on the later roles migration, so that one
  // falls back to an empty roster instead of taking the page down.
  const [properties, profiles, prospectAddresses, densityPoints, keywords, rankScans, previousRankPoints] =
    await Promise.all([
      listProperties(),
      listProfiles().catch(() => [] as Profile[]),
      // Coordinates only, for counting doors inside a drawn area. Empty until
      // somebody imports parcels, which the count itself then says.
      listProspectAddresses().catch(() => []),
      getDensityPoints().catch(() => []),
      // Empty until migration 0110 runs; the panel says so rather than the
      // page falling over.
      listKeywords().catch(() => []),
      listLatestScans().catch(() => []),
      listPreviousScanPoints().catch(() => new Map()),
    ]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:py-8">
      <AccessDeniedNotice tab={denied} />
      {locationsMigrationMissing && (
        <p className="mb-4 rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Business locations aren&apos;t set up yet. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0023_business_locations.sql</code>, then reload this page.
        </p>
      )}
      {/* One tab left, so no tabs. The book moved to /contacts, which is
          where somebody clicking "Contacts" was always going to look. */}
      <AttractorsDashboard
        types={types}
        keywords={keywords}
        rankScans={rankScans}
        previousRankPoints={Object.fromEntries(previousRankPoints)}
        variants={variants}
        waves={waves}
        jobs={jobs}
        locations={locations}
        areas={areas}
        properties={properties}
        prospectAddresses={prospectAddresses}
        densityPoints={densityPoints}
        profiles={profiles}
        currentProfileId={profile?.id ?? null}
      />
    </div>
  );
}


