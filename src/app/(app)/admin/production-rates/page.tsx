import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { listServiceTimeLogs } from "@/lib/data/service-timing";
import { createClient } from "@/lib/supabase/server";
import { isOwnerLevel } from "@/lib/roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ProductionRatesForm } from "@/components/pricing/production-rates-form";

/**
 * Production rates: the crew and what it is paid, and how much of each
 * service one crew-hour gets done. Every forward price is worked out from
 * these.
 */
export const dynamic = "force-dynamic";

export default async function ProductionRatesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("production-rates", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const [setup, timed] = await Promise.all([getProductionPricing(supabase, profile.organization_id), listServiceTimeLogs(supabase, profile.organization_id)]);
  const canEdit = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  return (
    <ProductionRatesForm
      initial={{ equation: setup.equation, services: setup.services }}
      saved={setup.saved}
      canSave={setup.canSave}
      canEdit={canEdit}
      updatedAt={setup.updatedAt}
      timeLogs={timed.logs}
      timingAvailable={timed.available}
    />
  );
}
