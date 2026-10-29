import type { createAdminClient } from "@/lib/supabase/admin";
import { blendedCrewRateCents } from "@/lib/job-costing";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { Material, ServiceMaterialRule, ServicePricing } from "@/types/domain";

/**
 * What the instant price needs from the rate card, for a client with no
 * account: the business's services, materials and markup, read with the
 * service role and scoped to the one organisation the job belongs to.
 *
 * The same numbers getCanvasCatalog gives a signed-in user, with one
 * difference: overhead charged per crew-hour comes from the bank's recurring
 * costs, which only a signed-in user can read, so here the flat overhead
 * percentage stands in for it.
 */
export type EstimateCatalog = Pick<
  CanvasCatalog,
  "servicePricing" | "serviceMaterialRules" | "materials" | "crewCostPerHourCents" | "markup" | "measurementUnit" | "measurementBasis"
>;

export async function estimateCatalogFor(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<EstimateCatalog> {
  const [services, materials, organization, profiles] = await Promise.all([
    admin.from("services").select("*").eq("organization_id", organizationId),
    admin.from("materials").select("*").eq("organization_id", organizationId).eq("active", true).eq("category", "job").order("name"),
    admin.from("organizations").select("*").eq("id", organizationId).single(),
    admin.from("profiles").select("pay_type, pay_rate_per_hour").eq("organization_id", organizationId),
  ]);
  if (services.error) throw services.error;
  if (materials.error) throw materials.error;
  if (organization.error) throw organization.error;

  const materialIds = (materials.data ?? []).map((m) => m.id);
  const rules = materialIds.length > 0 ? await admin.from("service_materials").select("*").in("material_id", materialIds) : { data: [], error: null };
  if (rules.error) throw rules.error;

  const org = organization.data;
  return {
    servicePricing: (services.data ?? []) as unknown as ServicePricing[],
    materials: (materials.data ?? []) as unknown as Material[],
    serviceMaterialRules: (rules.data ?? []) as unknown as ServiceMaterialRule[],
    crewCostPerHourCents: blendedCrewRateCents(
      (profiles.data ?? []).map((p) => ({ payType: p.pay_type, ratePerHour: p.pay_rate_per_hour })),
      org.crew_cost_per_hour
    ),
    markup: {
      multiplier: org.price_multiplier ?? 1,
      overheadPercent: org.overhead_percent ?? 0,
      overheadPerCrewHourCents: null,
    },
    measurementUnit: org.measurement_unit || "sq ft",
    measurementBasis: org.measurement_basis === "perimeter" || org.measurement_basis === "flat" ? org.measurement_basis : "area",
  };
}
