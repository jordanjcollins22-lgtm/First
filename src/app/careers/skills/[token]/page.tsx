import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { applicantByToken, careersOrg } from "@/lib/data/hiring";
import { positionFor } from "@/lib/hiring/positions";
import { SkillsStep } from "@/components/hiring/skills-step";

/** The skills question, for an applicant whose job tries out skills by link (step 4). */
export const dynamic = "force-dynamic";

export default async function ApplicantSkillsPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { token } = await params;
  const applicant = await applicantByToken(token);
  if (!applicant) notFound();
  const position = positionFor(applicant.position);
  const org = await careersOrg(applicant.organizationId);
  if (!position?.skillsQuestion || !org) notFound();
  const open = applicant.stage === "working_interview";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {org.name} · {position.title}
        </p>
        <h1 className="text-2xl font-bold leading-tight">One question, {applicant.firstName}</h1>
      </header>
      {open ? (
        <SkillsStep token={token} question={position.skillsQuestion} alreadyIn={applicant.skillsIn} businessName={org.name} />
      ) : (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          This question is closed. If that&apos;s a surprise, call {org.phone ?? "us"}.
        </p>
      )}
    </main>
  );
}
