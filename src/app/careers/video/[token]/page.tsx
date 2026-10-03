import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { applicantByToken, careersOrg } from "@/lib/data/hiring";
import { positionFor } from "@/lib/hiring/positions";
import { VideoStep } from "@/components/hiring/video-step";

/**
 * The video, for an applicant who passed the questions. Straight after
 * applying, and again from the link if they come back later to record it.
 */
export const dynamic = "force-dynamic";

export default async function ApplicantVideoPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const applicant = await applicantByToken(token);
  if (!applicant) notFound();
  const position = positionFor(applicant.position);
  const org = await careersOrg(applicant.organizationId);
  if (!position || !org) notFound();
  const open = applicant.stage === "video_requested" || applicant.stage === "video_submitted";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {org.name} · {position.title}
        </p>
        <h1 className="text-2xl font-bold leading-tight">
          {applicant.videoIn ? `Thanks, ${applicant.firstName}` : `You're a fit, ${applicant.firstName}. One more step`}
        </h1>
      </header>
      {open ? (
        <VideoStep token={token} prompt={position.videoPrompt} alreadyIn={applicant.videoIn} businessName={org.name} />
      ) : (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          This application is closed. If that&apos;s a surprise, call {org.phone ?? "us"}.
        </p>
      )}
    </main>
  );
}
