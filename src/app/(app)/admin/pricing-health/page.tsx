import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getPricingHealth } from "@/lib/data/pricing-health";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PricingHealthView } from "@/components/admin/pricing-health-view";

/**
 * Pricing health: can the estimate a client gets off the map be trusted,
 * and what to set so it can.
 *
 * Owner and admin only. It is about the rate card and the money the business
 * charges, and every fix it points at is on a page only they can change.
 * Gated on the roles directly, like Settings, so it needs no permission row
 * of its own.
 */
export const dynamic = "force-dynamic";

export default async function PricingHealthPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || !(profile.roles.includes("admin") || isOwnerLevel(profile.roles))) redirect("/my-day");

  return <PricingHealthView health={await getPricingHealth()} />;
}
