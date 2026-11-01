import { notFound } from "next/navigation";

import { requireTab } from "@/lib/data/access";
import { getCareerProgress } from "@/lib/data/career";
import { getRealProfile, listProfiles } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { STAGE_COUNT, summarize, targetMet } from "@/lib/career/stages";
import { BackLink } from "@/components/ui/back-link";
import { Progress } from "@/components/ui/progress";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CareerLadder } from "@/components/career/career-ladder";
import { CareerMigrationNotice } from "@/components/career/migration-notice";

/** One team member's career ladder: what's done, what they're on, what's next. */
export const dynamic = "force-dynamic";

export default async function TeamMemberCareerPage({ params }: { params: Promise<{ profileId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("career", "/my-day");

  const { profileId } = await params;
  const [profiles, me, { ready, progress }] = await Promise.all([
    listProfiles(),
    getRealProfile(),
    getCareerProgress(profileId),
  ]);
  const member = profiles.find((p) => p.id === profileId);
  if (!member) notFound();

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || p.email]));
  const summary = summarize(progress);
  // Nobody signs off their own stages, except an admin.
  const isSelf = me?.id === profileId;
  const editable = ready && (!isSelf || (me?.roles.includes("admin") ?? false));
  const next = summary.current;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <BackLink fallbackHref="/admin/career" label="Career Tracker" />
      <h1 className="mt-2 text-2xl font-bold">{member.full_name || member.email}</h1>
      <p className="mb-3 text-muted-foreground">
        {summary.tier.label} · {summary.completed} of {STAGE_COUNT} stages signed off
      </p>
      <Progress value={(summary.completed / STAGE_COUNT) * 100} className="mb-5 h-2" />

      {!ready && <CareerMigrationNotice />}

      {next && (
        <div className="mb-6 rounded-lg border border-primary/40 bg-primary/5 px-3 py-3 text-sm">
          <p className="font-semibold">
            What&apos;s next: Stage {next.number}, {next.title}
          </p>
          <p className="mt-0.5 text-muted-foreground">{next.requirement}</p>
          {next.target && (
            <p className="mt-1">
              {summary.currentCount} of {next.target.count} {next.target.unit}
              {targetMet(next, summary.currentCount) ? ", ready to sign off." : "."}
            </p>
          )}
        </div>
      )}
      {isSelf && !editable && ready && (
        <p className="mb-4 text-sm text-muted-foreground">
          This is your own ladder. Somebody else signs off your stages.
        </p>
      )}

      <CareerLadder profileId={profileId} progress={progress} names={names} editable={editable} />
    </div>
  );
}
