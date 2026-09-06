import { listAttractorTypes, listAttractorVariants, listAttractorWaves } from "@/lib/data/attractors";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listBusinessLocations, listLocationAreas } from "@/lib/data/locations";
import { listProperties } from "@/lib/data/properties";
import { listHousesWithHistory } from "@/lib/data/houses";
import { getEddmRates, listEddmMailings } from "@/lib/data/eddm";
import { eddmRouteSummary, latestEddmBuild, listUnservedClusters } from "@/lib/data/eddm-build";
import { EMPTY_OWNERSHIP, kindSummary, latestSdatImport, ownershipSummary, relationshipOwnershipMatrix } from "@/lib/data/ownership";
import { listZones } from "@/lib/data/zones";
import { listMarketingPlays } from "@/lib/data/marketing";
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
  searchParams: Promise<{ denied?: string; zone?: string }>;
}) {
  const { denied, zone } = await searchParams;
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
  const [properties, profiles, houses, densityPoints, keywords, rankScans, previousRankPoints, eddmRates, eddmMailings, eddmBuild, eddmSummary, unservedClusters, sdatJob, ownership, ownershipMatrix, zones, houseKinds] =
    await Promise.all([
      listProperties(),
      listProfiles().catch(() => [] as Profile[]),
      // The canonical houses with anyone or anything on them, for the map.
      listHousesWithHistory().catch(() => []),
      getDensityPoints().catch(() => []),
      // Empty until migration 0110 runs; the panel says so rather than the
      // page falling over.
      listKeywords().catch(() => []),
      listLatestScans().catch(() => []),
      listPreviousScanPoints().catch(() => new Map()),
      getEddmRates().catch(() => ({ postagePerPiece: null, printCostPerPiece: 0 })),
      listEddmMailings().catch(() => []),
      latestEddmBuild().catch(() => null),
      eddmRouteSummary().catch(() => ({ routes: 0, walkable: 0, hard: 0, unknown: 0, waves: 0, housesOnRoutes: 0, zips: 0 })),
      listUnservedClusters().catch(() => []),
      latestSdatImport().catch(() => null),
      ownershipSummary().catch(() => EMPTY_OWNERSHIP),
      relationshipOwnershipMatrix().catch(() => []),
      listZones().catch(() => []),
      kindSummary().catch(() => ({})),
    ]);
  // The marketing to do, synced on the way in so a client who paid a
  // minute ago is already on it.
  const plays = await listMarketingPlays({ sync: true }).catch(() => []);

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
        houses={houses}
        eddmRates={eddmRates}
        eddmMailings={eddmMailings}
        eddmBuild={eddmBuild}
        eddmSummary={eddmSummary}
        unservedClusters={unservedClusters}
        sdatJob={sdatJob}
        ownership={ownership}
        ownershipMatrix={ownershipMatrix}
        zones={zones}
        plays={plays}
        initialZoneId={zone ?? null}
        houseKinds={houseKinds}
        densityPoints={densityPoints}
        profiles={profiles}
        currentProfileId={profile?.id ?? null}
      />
    </div>
  );
}


