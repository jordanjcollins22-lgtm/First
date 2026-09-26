import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ModuleShell, holdsAny } from "@/components/module-shell";

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
        ...(map || leads ? { attribution: await AttributionTab() } : {}),
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
  const [report, bookingTest] = await Promise.all([
    attributionReport().catch((err) => {
      console.error("Attribution failed to load:", err);
      return null;
    }),
    // The booking page's own test, the owner's to read.
    owner ? getBookingTest().catch(() => null) : Promise.resolve(null),
  ]);
  const test = bookingTest ? <BookingTestCard test={bookingTest} /> : null;
  if (!report) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">The attribution could not be worked out just now.</p>
        {test}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <AttributionPanel totals={report.totals} health={report.health} jobs={report.jobs} />
      {test}
    </div>
  );
}
