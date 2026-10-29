import type { SupabaseClient } from "@supabase/supabase-js";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { getPlantAvailability } from "@/lib/data/plant-availability";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { createClient } from "@/lib/supabase/server";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PlantAvailability } from "@/components/suppliers/plant-availability";

/**
 * The plants the nurseries have this week, from each one's availability
 * list: size, what one costs us (the sale price while it holds), what we
 * charge for it on its own and planted, and how many they have.
 */
export const dynamic = "force-dynamic";

export default async function PlantsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("plants", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const [{ plants, ready }, setup] = await Promise.all([
    getPlantAvailability(supabase as unknown as SupabaseClient, profile.organization_id),
    getProductionPricing(supabase, profile.organization_id),
  ]);
  return <PlantAvailability plants={plants} ready={ready} equation={setup.equation} services={setup.services} />;
}
