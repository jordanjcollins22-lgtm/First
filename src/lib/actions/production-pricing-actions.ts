"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { refuseInDemo } from "@/lib/demo-mode";
import { readSetup } from "@/lib/forward-pricing";

type Result = { ok: true; savedAt: string } | { ok: false; error: string };

/**
 * Saves the crew's makeup and pay and every service's production rate.
 * Owners and admins only: every price from here on is worked out from it.
 * Prices already approved keep the figure they were approved at.
 */
export async function saveProductionPricing(input: unknown): Promise<Result> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { ok: false, error: "Only an owner or admin can change production rates." };
  const read = readSetup(input);
  if (!read.ok) return read;
  const { equation, services } = read.setup;
  const savedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("production_pricing")
    .upsert({
      organization_id: profile.organization_id,
      leads: equation.leads,
      lead_rate_cents: equation.leadRateCents,
      technicians: equation.technicians,
      technician_rate_cents: equation.technicianRateCents,
      services,
      updated_at: savedAt,
      updated_by: profile.id,
    });
  if (error) {
    console.error("[production-pricing] save failed:", error.message);
    return { ok: false, error: /production_pricing/.test(error.message) ? "This can't be saved until database update 0336 is applied." : "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/production-rates");
  revalidatePath("/my-day");
  return { ok: true, savedAt };
}
