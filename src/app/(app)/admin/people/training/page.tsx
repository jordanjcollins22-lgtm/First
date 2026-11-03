import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listModules } from "@/lib/data/people";
import { TrainingLibrary } from "@/components/people/training-library";

/** The training library, by position and skill. */
export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return <SetupRequiredNotice />;
  await requireTab("people", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return <TrainingLibrary modules={await listModules(profile.organization_id)} />;
}
