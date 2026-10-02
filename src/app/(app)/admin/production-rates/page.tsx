import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getProductionPricing } from "@/lib/data/production-pricing";
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
  const setup = await getProductionPricing(await createClient(), profile.organization_id);
  const canEdit = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  return (
    <ProductionRatesForm
      initial={{ equation: setup.equation, services: setup.services }}
      saved={setup.saved}
      canSave={setup.canSave}
      canEdit={canEdit}
      updatedAt={setup.updatedAt}
    />
  );
}
