"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export async function updateServicePricing(
  serviceTypeId: string,
  cost: number | null,
  costUnit: string,
  estimatedHours: number | null
) {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { error } = await supabase.from("services").upsert({
    organization_id: organizationId,
    service_type_id: serviceTypeId,
    cost,
    cost_unit: costUnit || "flat rate",
    estimated_hours: estimatedHours,
  });
  if (error) throw error;

  revalidatePath("/admin/service-pricing");
  revalidatePath("/canvas");
}
