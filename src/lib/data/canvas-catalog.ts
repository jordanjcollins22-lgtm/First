import { createClient } from "@/lib/supabase/server";
import { listTools } from "./tools";
import { listMaterials } from "./materials";
import { listServicePricing } from "./service-pricing";
import { listCustomFieldOptions, type CustomFieldOptions } from "./custom-field-options";
import { listBusinessLocations } from "./locations";
import { getCurrentOrganization } from "./organizations";
import { listProfiles } from "./team";
import { blendedCrewRateCents, type Markup } from "@/lib/job-costing";
import type {
  MeasurementBasis,
  Material,
  ServiceMaterialRule,
  ServicePricing,
  ServiceToolLink,
  Tool,
} from "@/types/domain";

export interface CanvasCatalog {
  tools: Tool[];
  materials: Material[];
  serviceTools: ServiceToolLink[];
  serviceMaterialRules: ServiceMaterialRule[];
  servicePricing: ServicePricing[];
  customFieldOptions: CustomFieldOptions;
  /** Business location names from the Project Data map — the same places
   * Inventory's "Stored at" picker offers. */
  storageLocations: string[];
  /** The business's pricing unit and what a per-unit price multiplies by. */
  measurementUnit: string;
  measurementBasis: MeasurementBasis;
  /**
   * What one crew-hour costs, in whole cents. Zero when nobody has set a rate
   * yet, which prices every hour of labour at nothing -- visibly wrong rather
   * than quietly guessed.
   */
  crewCostPerHourCents: number;
  /** How direct cost becomes the price a client is quoted. */
  markup: Markup;
}

export async function getCanvasCatalog(): Promise<CanvasCatalog> {
  const supabase = await createClient();
  const [
    tools,
    materials,
    servicePricing,
    customFieldOptions,
    organization,
    serviceToolsRes,
    serviceMaterialsRes,
    businessLocations,
    profiles,
  ] = await Promise.all([
    listTools(),
    listMaterials(),
    listServicePricing(),
    listCustomFieldOptions(),
    getCurrentOrganization(),
    supabase.from("service_tools").select("*"),
    supabase.from("service_materials").select("*"),
    listBusinessLocations().catch(() => []),
    // Labour is most of the cost of most jobs, so the rate cannot come from a
    // manual figure while the Team page shows a blended one off real pay.
    listProfiles().catch(() => []),
  ]);

  if (serviceToolsRes.error) throw serviceToolsRes.error;
  if (serviceMaterialsRes.error) throw serviceMaterialsRes.error;

  return {
    tools,
    materials,
    servicePricing,
    customFieldOptions,
    storageLocations: businessLocations.map((location) => location.name),
    crewCostPerHourCents: blendedCrewRateCents(
      profiles.map((profile) => ({
        payType: profile.pay_type,
        ratePerHour: profile.pay_rate_per_hour,
      })),
      organization.crew_cost_per_hour
    ),
    markup: {
      multiplier: organization.price_multiplier ?? 1,
      overheadPercent: organization.overhead_percent ?? 0,
    },
    measurementUnit: organization.measurement_unit || "sq ft",
    measurementBasis:
      organization.measurement_basis === "perimeter" || organization.measurement_basis === "flat"
        ? organization.measurement_basis
        : "area",
    serviceTools: (serviceToolsRes.data ?? []) as unknown as ServiceToolLink[],
    serviceMaterialRules: (serviceMaterialsRes.data ?? []) as unknown as ServiceMaterialRule[],
  };
}
