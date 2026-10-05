import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listApplicants } from "@/lib/data/hiring";
import { POSITIONS } from "@/lib/hiring/positions";
import { indeedAd, needsPay } from "@/lib/hiring/indeed-ad";
import { outboundBaseUrl } from "@/lib/base-url";
import { appUrl } from "@/lib/app-url";
import { HiringBoard } from "@/components/hiring/hiring-board";
import { HIRING_INBOX, listIndeedInvites } from "@/lib/data/indeed-invite";

/**
 * Hiring: who applied from the job ads, whose video is waiting to be
 * watched, and the ads themselves, ready to paste into Indeed.
 */
export const dynamic = "force-dynamic";

export default async function HiringPage({ searchParams }: { searchParams?: Promise<{ position?: string; stage?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("hiring", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { position: positionFilter, stage: stageFilter } = (await searchParams) ?? {};

  const [applicants, base, org, invites] = await Promise.all([
    listApplicants(profile.organization_id).catch((err) => {
      console.error("Hiring failed to load:", err);
      return null;
    }),
    outboundBaseUrl(),
    getCurrentOrganization().catch(() => null),
    listIndeedInvites().catch((err) => {
      console.error("Indeed invites failed to load:", err);
      return null;
    }),
  ]);

  const ads = POSITIONS.map((p) => {
    const applyUrl = appUrl(base, `/careers/${p.key}?src=indeed`);
    return { key: p.key, ...indeedAd(p, { business: org?.name ?? "JS Landscaping MD", area: "Harford County, Maryland", applyUrl }), applyUrl, needsPay: needsPay(p) };
  });

  return (
    <HiringBoard
      applicants={applicants}
      ads={ads}
      careersUrl={appUrl(base, "/careers")}
      indeedInvites={invites}
      hiringInbox={HIRING_INBOX}
      positionFilter={positionFilter}
      stageFilter={stageFilter}
    />
  );
}
