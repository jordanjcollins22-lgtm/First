import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getTestRuns } from "@/lib/data/test-runs";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { TestRunsView } from "@/components/admin/test-runs-view";

/**
 * The runs of the booking funnel from the test link, each with what the
 * person asked for, the estimate they got and how far they went. Owner and
 * admin only, like the Funnel page.
 */
export const dynamic = "force-dynamic";

export default async function TestRunsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || !(profile.roles.includes("admin") || isOwnerLevel(profile.roles))) redirect("/my-day");

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", profile.organization_id).maybeSingle();
  // The link is to this same site: the test mode only exists where this
  // page does, so a link to another deployment could lack it.
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  const proto = list.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const link = org?.slug && host ? `${proto}://${host}/book?org=${encodeURIComponent(org.slug)}&test=1` : null;

  const { runs, problems } = await getTestRuns();
  return <TestRunsView runs={runs} problems={problems} link={link} />;
}
