import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { buddyChoices, getJourney } from "@/lib/data/journey";
import { journeyProps } from "@/lib/hiring/journey-props";
import { NewHireJourney } from "@/components/hiring/new-hire-journey";

/** One new hire's way from day one to fully operating. */
export const dynamic = "force-dynamic";

export default async function NewHirePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("hiring", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { id } = await params;
  const j = await getJourney(profile.organization_id, id);
  if (!j) notFound();
  const props = journeyProps(j, await buddyChoices(profile.organization_id, j.profileId, j.position));
  if (!props) notFound();
  return <NewHireJourney {...props} />;
}
