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
import { PageTabs } from "@/components/ui/page-tabs";
import { getContacts, type ContactsData } from "@/lib/data/contacts";
import { ContactsManager } from "@/components/contacts/contacts-manager";
import { checkTabAccess as checkTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";

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

  // The one contacts list in the app. It used to be a tab on Pipeline while
  // /contacts redirected there, so nobody could say where the book lived.
  const contactAccess = await checkTab("contacts");

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:py-8">
      <AccessDeniedNotice tab={denied} />
      {locationsMigrationMissing && (
        <p className="mb-4 rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Business locations aren&apos;t set up yet. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0023_business_locations.sql</code>, then reload this page.
        </p>
      )}
      <PageTabs
        tabs={[
          {
            key: "map",
            label: "Map",
            content: (
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
            ),
          },
          {
            key: "contacts",
            label: "Contacts",
            content: contactAccess.allowed ? await ContactsTab() : null,
            visible: contactAccess.allowed,
          },
        ]}
      />
    </div>
  );
}

/**
 * The whole contact book, searchable, in one place.
 *
 * Importing is not here: it has its own address at /contacts, so the page
 * somebody opens to look somebody up is not also the page that can overwrite
 * three thousand records.
 */
async function ContactsTab() {
  const profile = await getCurrentProfile();
  // Merging is irreversible, so it stays with admins even where the page
  // itself is open to more people.
  const canMerge = Boolean(profile?.roles.includes("admin"));

  let data: ContactsData = {
    contacts: [],
    duplicates: [],
    pendingGeocodes: 0,
    failedGeocodes: 0,
    recentMerges: [],
    outOfArea: [],
  };
  try {
    data = await getContacts();
  } catch (err) {
    console.error("Contacts failed to load:", err);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">Contacts</h1>
      <p className="mb-6 text-muted-foreground">
        Everyone in the book. Search by name, email, phone or address.
      </p>
      <ContactsManager data={data} canMerge={canMerge} />
    </div>
  );
}
