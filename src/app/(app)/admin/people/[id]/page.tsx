import { notFound } from "next/navigation";

import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getPerson } from "@/lib/data/people";
import { PersonView } from "@/components/people/person-view";

/** One person, from their application to today. */
export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return <SetupRequiredNotice />;
  await requireTab("people", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { id } = await params;
  const detail = await getPerson(profile.organization_id, id).catch((err) => {
    console.error("Person failed to load:", err);
    return null;
  });
  if (!detail) notFound();
  return <PersonView detail={detail} />;
}
