import type { SupabaseClient } from "@supabase/supabase-js";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { blendedCrewRateCents } from "@/lib/job-costing";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { Material, ServiceMaterialRule, ServicePricing } from "@/types/domain";
import { withRealCosts, type ListedProduct } from "@/lib/material-costs";

/**
 * The business's supplier price list, for what a material costs when its own
 * cost is blank. Empty when there is none or it can't be read: pricing then
 * goes on as before rather than failing a client's estimate.
 */
export async function supplierPriceList(db: SupabaseClient<Database>, organizationId: string): Promise<ListedProduct[]> {
  // Every column, so the preferred product and a product's material (added
  // on another branch's update) are read where the database has them and
  // simply absent where it doesn't.
  const { data, error } = await db
    .from("supplier_products")
    .select("*, supplier:material_suppliers(name, active)")
    .eq("organization_id", organizationId);
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).flatMap((p) => {
    const supplier = p.supplier as { name: string; active: boolean } | null;
    if (supplier && supplier.active === false) return [];
    const cents = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
    return [
      {
        kind: String(p.kind ?? ""),
        name: String(p.name ?? ""),
        unit: String(p.unit ?? ""),
        priceCents: cents(p.price_cents),
        deliveredPriceCents: cents(p.delivered_price_cents),
        active: p.active !== false,
        preferred: p.preferred === true,
        materialId: typeof p.material_id === "string" ? p.material_id : null,
        supplier: supplier?.name ?? null,
      },
    ];
  });
}

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
  const [services, materials, organization, profiles, listed] = await Promise.all([
    admin.from("services").select("*").eq("organization_id", organizationId),
    admin.from("materials").select("*").eq("organization_id", organizationId).eq("category", "job").order("name"),
    admin.from("organizations").select("*").eq("id", organizationId).single(),
    admin.from("profiles").select("pay_type, pay_rate_per_hour").eq("organization_id", organizationId),
    supplierPriceList(admin, organizationId),
  ]);
  if (services.error) throw services.error;
  if (materials.error) throw materials.error;
  if (organization.error) throw organization.error;

  const allMaterials = (materials.data ?? []) as unknown as Material[];
  const materialIds = allMaterials.map((m) => m.id);
  const rules = materialIds.length > 0 ? await admin.from("service_materials").select("*").in("material_id", materialIds) : { data: [], error: null };
  if (rules.error) throw rules.error;
  // A material switched off in the inventory list is still what a rate card
  // rule puts on the job (mulch on a mulch bed), so it is priced while a rule
  // uses it; one no rule uses stays out.
  const ruled = new Set((rules.data ?? []).map((r) => r.material_id));
  const used = allMaterials.filter((m) => m.active || ruled.has(m.id));

  const org = organization.data;
  return {
    servicePricing: (services.data ?? []) as unknown as ServicePricing[],
    // What each really costs: its own figure, or the supplier price list's.
    materials: withRealCosts(used, listed),
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
