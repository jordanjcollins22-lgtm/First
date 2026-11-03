import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listTemplates } from "@/lib/data/people";
import { PeopleSetup } from "@/components/people/people-setup";

/** The reusable checklists, the standard definitions, and every SOP in one format. */
export const dynamic = "force-dynamic";

export default async function PeopleSetupPage() {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return <SetupRequiredNotice />;
  await requireTab("people", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const templates = await listTemplates(profile.organization_id);
  return <PeopleSetup templates={templates} />;
}
