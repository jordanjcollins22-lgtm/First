import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ensureStarterContent, loadDashboard } from "@/lib/data/people";
import { PeopleDashboardView } from "@/components/people/people-dashboard";

/** Everybody from applicant to team member: where they are, what's missing, and what happens next. */
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return <SetupRequiredNotice />;
  await requireTab("people", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const dashboard = await loadDashboard(profile.organization_id);
  if (dashboard.ready) await ensureStarterContent(profile.organization_id).catch((err) => console.error("People starter content failed:", err));
  return <PeopleDashboardView dashboard={dashboard} />;
}
