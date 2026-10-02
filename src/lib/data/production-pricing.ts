import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { DEFAULT_SETUP, readSetup, type PricingSetup } from "@/lib/forward-pricing";

export interface StoredSetup extends PricingSetup {
  /** Whether the business has saved its own; false while the starting figures are in use. */
  saved: boolean;
  /** False when the table isn't there yet (migration 0336 not applied), so nothing can be saved. */
  canSave: boolean;
  updatedAt: string | null;
}

/**
 * The business's forward pricing settings: its crew, its pay and every
 * service's production rate. The starting figures until it has saved its
 * own, and also when the settings can't be read, so a price can always be
 * worked out.
 */
export async function getProductionPricing(supabase: SupabaseClient<Database>, organizationId: string): Promise<StoredSetup> {
  const { data, error } = await supabase
    .from("production_pricing")
    .select("leads, lead_rate_cents, technicians, technician_rate_cents, services, updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    // 42P01 / PGRST205: the table isn't there yet.
    const missing = error.code === "42P01" || error.code === "PGRST205" || /production_pricing/.test(error.message ?? "");
    if (!missing) console.error("[production-pricing] read failed:", error.message);
    return { ...DEFAULT_SETUP, saved: false, canSave: !missing, updatedAt: null };
  }
  if (!data) return { ...DEFAULT_SETUP, saved: false, canSave: true, updatedAt: null };
  const read = readSetup({
    equation: { leads: data.leads, technicians: data.technicians, leadRateCents: data.lead_rate_cents, technicianRateCents: data.technician_rate_cents },
    services: data.services,
  });
  if (!read.ok) {
    console.error("[production-pricing] stored settings unreadable:", read.error);
    return { ...DEFAULT_SETUP, saved: false, canSave: true, updatedAt: data.updated_at };
  }
  return { ...read.setup, saved: true, canSave: true, updatedAt: data.updated_at };
}
