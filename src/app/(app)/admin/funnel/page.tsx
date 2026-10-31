import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { FUNNEL_RANGES, getFunnelOverview } from "@/lib/data/funnel-stats";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { FunnelView } from "@/components/admin/funnel-view";

/**
 * The client funnel, page by page: booking, the map pre-evaluation, the
 * estimate, paying, and the visit time. Owner and admin only, like Pricing
 * health: it is the business's sales numbers.
 */
export const dynamic = "force-dynamic";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || !(profile.roles.includes("admin") || isOwnerLevel(profile.roles))) redirect("/my-day");

  const asked = Number((await searchParams).days);
  const days = (FUNNEL_RANGES as readonly number[]).includes(asked) ? asked : 30;
  return <FunnelView overview={await getFunnelOverview(days)} />;
}
