import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getApplicant } from "@/lib/data/hiring";
import { ApplicantView } from "@/components/hiring/applicant-view";
import { personIdForApplicant } from "@/lib/data/people";

/** One applicant: their answers, their video, what you thought, and what happens next. */
export const dynamic = "force-dynamic";

export default async function ApplicantPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("hiring", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { id } = await params;
  const applicant = await getApplicant(profile.organization_id, id);
  if (!applicant) notFound();
  const personId = await personIdForApplicant(profile.organization_id, id).catch(() => null);
  return <ApplicantView applicant={applicant} personId={personId} />;
}
