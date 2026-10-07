import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";
import { Deferred } from "@/components/deferred";

// Each of these keeps its own address, data loading and permission guard.
import AttractorsPage from "@/app/(app)/attractors/page";
import LeadsPage from "@/app/(app)/leads/page";
import DoorHangersPage from "@/app/(app)/admin/door-hangers/page";
import FlyerPage from "@/app/(app)/admin/flyer/page";
import SocialPage from "@/app/(app)/admin/social/page";
import PostsToAnswerPage from "@/app/(app)/admin/outreach/posts/page";
import { AttributionPanel } from "@/components/marketing/attribution-panel";
import { BookingTestCard } from "@/components/marketing/booking-test-card";
import { attributionReport } from "@/lib/data/attribution";
import { getBookingTest } from "@/lib/data/booking-test";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { LeadSourcesPanel } from "@/components/marketing/lead-sources-panel";
import { listLeadSources } from "@/lib/data/lead-sources";
import { PropertyManagers } from "@/components/marketing/property-managers";
import { getPmBoard } from "@/lib/data/pm-board";

/**
 * Where the next customer comes from.
 *
 * The map, the campaigns on it, the paper that goes out, and the posts made
 * from what the crew photographed. These were five separate nav entries for
 * one job.
 */
export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { tab } = await searchParams;

  const [map, leads, hangers, flyer, content, posts] = await Promise.all([
    holdsAny(["project-data"]),
    holdsAny(["leads"]),
    holdsAny(["door-hangers"]),
    holdsAny(["flyer"]),
    holdsAny(["social"]),
    holdsAny(["posts-to-answer"]),
  ]);

  return (
    <ModuleShell
      module="marketing"
      asked={tab}
      content={{
        ...(map ? { map: <AttractorsPage searchParams={Promise.resolve({})} /> } : {}),
        ...(leads ? { leads: <LeadsPage /> } : {}),
        ...(hangers || flyer
          ? {
              print: (
                <div className="space-y-8">
                  {hangers && <DoorHangersPage />}
                  {flyer && <FlyerPage />}
                </div>
              ),
            }
          : {}),
        ...(content || posts
          ? {
              content: (
                <div className="space-y-8">
                  {posts && <PostsToAnswerPage />}
                  {content && <SocialPage />}
                </div>
              ),
            }
          : {}),
        ...(leads ? { "property-managers": <Deferred load={PropertyManagersTab} /> } : {}),
        ...(map || leads ? { attribution: <Deferred load={AttributionTab} /> } : {}),
      }}
    />
  );
}

/**
 * What actually brought the work in.
 *
 * Fails on its own: a payments table that will not read costs this subtab and
 * nothing else on the module.
 */
async function AttributionTab() {
  const profile = await getCurrentProfile();
  const owner = isOwnerLevel(profile?.roles ?? []);
  const [report, bookingTest, leads] = await Promise.all([
    attributionReport().catch((err) => {
      console.error("Attribution failed to load:", err);
      return null;
    }),
    // The booking page's own test, the owner's to read.
    owner ? getBookingTest().catch(() => null) : Promise.resolve(null),
    // Every lead and where it came from, first on the tab.
    listLeadSources().catch((err) => {
      console.error("Lead sources failed to load:", err);
      return null;
    }),
  ]);
  const sources = leads ? <LeadSourcesPanel leads={leads} now={new Date().toISOString()} /> : null;
  const test = bookingTest ? <BookingTestCard test={bookingTest} /> : null;
  if (!report) {
    return (
      <div className="space-y-6">
        {sources}
        <p className="text-sm text-muted-foreground">The attribution could not be worked out just now.</p>
        {test}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {sources}
      <AttributionPanel totals={report.totals} health={report.health} jobs={report.jobs} />
      {test}
    </div>
  );
}

/**
 * Cold email to property managers. The owner's alone: it sends in their
 * name, so nobody else reads or approves it.
 */
async function PropertyManagersTab() {
  const profile = await getCurrentProfile();
  if (!profile || !isOwnerLevel(profile.roles)) {
    return <p className="text-sm text-muted-foreground">Only an owner can see the property manager emails.</p>;
  }
  const board = await getPmBoard(profile.organization_id).catch((err) => {
    console.error("Property managers failed to load:", err);
    return null;
  });
  if (!board) return <p className="text-sm text-muted-foreground">The property manager list could not be loaded just now.</p>;
  return <PropertyManagers board={board} />;
}
